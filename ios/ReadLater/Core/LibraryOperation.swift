import Foundation

/// 和电脑插件、网页使用的"操作记录"格式完全一致（见 packages/storage 的 library-operations）。
/// 云端只追加记录，不改动旧记录；这里只会产生一条 create。
struct LibraryOperation {
    let id: String
    let at: Int64
    let url: String
    let kind: String            // create / patch / delete
    let patch: [String: Any]

    /// 与网页端 serializeOperation 一致：键按字母排序、不转义斜杠，紧凑输出。
    func serialized() throws -> String {
        let object: [String: Any] = ["id": id, "at": at, "url": url, "kind": kind, "patch": patch]
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        guard let text = String(data: data, encoding: .utf8) else { throw SaveError.encoding }
        return text
    }

    /// 保存一个新页面时的完整记录（字段与网页端 fullPatch 相同，没有的值写 null）。
    static func create(pageId: String, operationId: String, url: URL, title: String, articleText: String?, savedAt: Date, autoTags: [String]) -> LibraryOperation {
        let ms = Int64((savedAt.timeIntervalSince1970 * 1000).rounded())
        let patch: [String: Any] = [
            "id": pageId,
            "title": title,
            "favicon": NSNull(),
            "tags": [String](),
            "autoTags": autoTags,
            "savedAt": ms,
            "visitedAt": NSNull(),
            "notes": NSNull(),
            "articleText": articleText.map { $0 as Any } ?? NSNull(),
            "progress": NSNull(),
        ]
        return LibraryOperation(id: operationId, at: ms, url: url.absoluteString, kind: "create", patch: patch)
    }

    /// 从云端读回来的记录，只用于判断某个链接是否已经在库里。
    struct Remote: Decodable {
        let id: String
        let at: Double
        let url: String
        let kind: String
    }
}

enum SaveError: LocalizedError {
    case encoding
    case notSignedIn
    case auth(String)
    case network(String)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .encoding: return "内容编码失败"
        case .notSignedIn: return "还没有登录"
        case .auth(let message): return message
        case .network(let message): return message
        case .server(let code, let message): return "云端返回 \(code)：\(message)"
        }
    }
}
