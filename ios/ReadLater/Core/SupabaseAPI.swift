import Foundation

/// 只实现保存所需的最小云端接口：登录、刷新登录、查重、追加一条记录。
struct SupabaseAPI {
    var urlSession: URLSession = .shared
    var baseURL: URL = Config.supabaseURL
    var key: String = Config.publishableKey

    private struct TokenResponse: Decodable {
        struct User: Decodable { let id: String; let email: String? }
        let access_token: String
        let refresh_token: String
        let expires_in: Double
        let user: User
    }

    private func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET", token: String? = nil, body: Data? = nil, extra: [String: String] = [:]) throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.percentEncodedQueryItems = query }
        var req = URLRequest(url: components.url!, timeoutInterval: 20)
        req.httpMethod = method
        req.httpBody = body
        req.setValue(key, forHTTPHeaderField: "apikey")
        req.setValue("Bearer " + (token ?? key), forHTTPHeaderField: "Authorization")
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        for (name, value) in extra { req.setValue(value, forHTTPHeaderField: name) }
        return req
    }

    private func send(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await urlSession.data(for: req)
            guard let http = response as? HTTPURLResponse else { throw SaveError.network("云端响应异常") }
            return (data, http)
        } catch let error as SaveError {
            throw error
        } catch {
            throw SaveError.network("网络不可用：" + error.localizedDescription)
        }
    }

    private func message(from data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for key in ["msg", "message", "error_description", "error"] {
                if let text = object[key] as? String, !text.isEmpty { return text }
            }
        }
        return String(data: data, encoding: .utf8)?.prefix(200).description ?? ""
    }

    private func session(from data: Data, now: Date, fallbackEmail: String) throws -> Session {
        let token = try JSONDecoder().decode(TokenResponse.self, from: data)
        return Session(accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now.addingTimeInterval(token.expires_in), userId: token.user.id, email: token.user.email ?? fallbackEmail)
    }

    func signIn(email: String, password: String, now: Date = Date()) async throws -> Session {
        let body = try JSONSerialization.data(withJSONObject: ["email": email.trimmingCharacters(in: .whitespaces), "password": password])
        let req = try request("auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "password")], method: "POST", body: body)
        let (data, http) = try await send(req)
        guard http.statusCode == 200 else { throw SaveError.auth(http.statusCode == 400 ? "邮箱或密码不正确" : message(from: data)) }
        return try session(from: data, now: now, fallbackEmail: email)
    }

    func refresh(_ old: Session, now: Date = Date()) async throws -> Session {
        let body = try JSONSerialization.data(withJSONObject: ["refresh_token": old.refreshToken])
        let req = try request("auth/v1/token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")], method: "POST", body: body)
        let (data, http) = try await send(req)
        guard http.statusCode == 200 else { throw SaveError.auth("登录已失效，请打开 Read Later 重新登录") }
        return try session(from: data, now: now, fallbackEmail: old.email)
    }

    /// 这个链接现在是否还在阅读库里（最后一条记录不是删除）。
    func isLinkInLibrary(_ url: URL, session: Session) async throws -> Bool {
        let needle = "\"url\":\"" + url.absoluteString + "\""
        let encoded = needle.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~:/"))) ?? needle
        let query = [
            URLQueryItem(name: "select", value: "payload"),
            URLQueryItem(name: "user_id", value: "eq." + session.userId),
            URLQueryItem(name: "payload", value: "ilike.*" + encoded.replacingOccurrences(of: "%2A", with: "") + "*"),
            URLQueryItem(name: "limit", value: "50"),
        ]
        let (data, http) = try await send(try request("rest/v1/" + Config.operationsTable, query: query, token: session.accessToken))
        if http.statusCode == 401 { throw SaveError.auth("expired") }
        guard http.statusCode == 200 else { throw SaveError.server(http.statusCode, message(from: data)) }
        struct Row: Decodable { let payload: String }
        let rows = try JSONDecoder().decode([Row].self, from: data)
        let decoder = JSONDecoder()
        var operations: [LibraryOperation.Remote] = []
        for row in rows {
            guard let op = try? decoder.decode(LibraryOperation.Remote.self, from: Data(row.payload.utf8)) else { continue }
            if op.url == url.absoluteString { operations.append(op) }
        }
        operations.sort { (a: LibraryOperation.Remote, b: LibraryOperation.Remote) -> Bool in
            if a.at != b.at { return a.at < b.at }
            return a.id < b.id
        }
        guard let last = operations.last else { return false }
        return last.kind != "delete"
    }

    func append(_ operation: LibraryOperation, session: Session) async throws {
        let payload = try operation.serialized()
        let row: [String: String] = ["user_id": session.userId, "id": operation.id, "payload": payload]
        let body = try JSONSerialization.data(withJSONObject: [row], options: [.sortedKeys])
        let req = try request("rest/v1/" + Config.operationsTable, method: "POST", token: session.accessToken, body: body,
                              extra: ["Prefer": "resolution=ignore-duplicates,return=minimal"])
        let (data, http) = try await send(req)
        if http.statusCode == 401 { throw SaveError.auth("expired") }
        guard (200...299).contains(http.statusCode) else { throw SaveError.server(http.statusCode, message(from: data)) }
    }

    struct RemoteRow: Decodable, Equatable {
        let id: String
        let created_at: String
        let payload: String
    }

    /// 读取 cursor 之后新增的记录（按写入时间升序）。用 gte 加按 id 去重，避免同一批写入时间相同而漏读。
    func fetchOperations(session: Session, since cursor: String?, limit: Int = 200) async throws -> [RemoteRow] {
        var query = [
            URLQueryItem(name: "select", value: "id,created_at,payload"),
            URLQueryItem(name: "user_id", value: "eq." + session.userId),
            URLQueryItem(name: "order", value: "created_at.asc,id.asc"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let cursor {
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~:"))
            query.append(URLQueryItem(name: "created_at", value: "gte." + (cursor.addingPercentEncoding(withAllowedCharacters: allowed) ?? cursor)))
        }
        let (data, http) = try await send(try request("rest/v1/" + Config.operationsTable, query: query, token: session.accessToken))
        if http.statusCode == 401 { throw SaveError.auth("expired") }
        guard http.statusCode == 200 else { throw SaveError.server(http.statusCode, message(from: data)) }
        return try JSONDecoder().decode([RemoteRow].self, from: data)
    }
}
