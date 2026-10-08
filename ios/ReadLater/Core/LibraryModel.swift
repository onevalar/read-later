import Foundation

enum SyncState: Equatable {
    case idle
    case syncing
    case synced(Date)
    case pending(Int)          // 有改动还没上传（离线或失败）
    case needsSignIn
    case failed(String)

    var label: String {
        switch self {
        case .idle: return ""
        case .syncing: return "正在同步…"
        case .synced: return "已同步"
        case .pending(let count): return "等待同步 · \(count) 项改动"
        case .needsSignIn: return "登录后同步"
        case .failed: return "同步需要处理"
        }
    }
}

@MainActor
final class LibraryModel: ObservableObject {
    @Published private(set) var items: [LibraryItem] = []
    @Published private(set) var syncState: SyncState = .idle

    private var local: LocalLibrary
    private let persistence: LibraryPersisting
    private let api: SupabaseAPI
    private let store: SessionStoring
    private var syncing = false
    private var needsAnotherPass = false
    private let now: () -> Date

    init(persistence: LibraryPersisting = FileLibraryPersistence(), api: SupabaseAPI = SupabaseAPI(), store: SessionStoring = KeychainSessionStore(), now: @escaping () -> Date = Date.init) {
        self.persistence = persistence
        self.api = api
        self.store = store
        self.now = now
        self.local = persistence.load()
        rebuild()
    }

    var unreadCount: Int { items.filter { !$0.isRead }.count }
    var readCount: Int { items.count - unreadCount }
    var pendingCount: Int { local.ops.filter { !$0.pushed }.count }

    // MARK: 同步

    /// 先上传本机还没上传的改动，再拉取云端新增的记录。重复调用会合并成一次。
    func sync() async {
        if syncing { needsAnotherPass = true; return }
        guard let session = store.load() else { syncState = .needsSignIn; return }
        if local.userId != nil && local.userId != session.userId { local = LocalLibrary(); rebuild() }
        local.userId = session.userId
        syncing = true
        syncState = .syncing
        defer { syncing = false }
        repeat {
            needsAnotherPass = false
            do {
                let access = CloudAccess(api: api, store: store, now: now)
                try await pushPending(access)
                try await pull(access)
                syncState = .synced(now())
                local.lastSyncedAt = now()
            } catch SaveError.notSignedIn {
                syncState = .needsSignIn
            } catch SaveError.auth(_) {
                store.clear()
                syncState = .needsSignIn
            } catch let error as SaveError {
                if case .network = error, pendingCount > 0 { syncState = .pending(pendingCount) } else { syncState = .failed(error.localizedDescription) }
            } catch {
                syncState = .failed(error.localizedDescription)
            }
            persistence.save(local)
        } while needsAnotherPass
    }

    private func pushPending(_ access: CloudAccess) async throws {
        for index in local.ops.indices where !local.ops[index].pushed {
            let op = local.ops[index]
            guard let object = (try? JSONSerialization.jsonObject(with: Data(op.payload.utf8))) as? [String: Any],
                  let url = object["url"] as? String, let kind = object["kind"] as? String else { local.ops[index].pushed = true; continue }
            let operation = LibraryOperation(id: op.id, at: op.at, url: url, kind: kind, patch: object["patch"] as? [String: Any] ?? [:])
            try await access.perform { try await api.append(operation, session: $0) }
            local.ops[index].pushed = true
        }
    }

    private func pull(_ access: CloudAccess) async throws {
        for _ in 0..<200 {   // 安全上限：最多 4 万条记录
            let rows = try await access.perform { try await api.fetchOperations(session: $0, since: local.cursor) }
            var known = Set(local.ops.map(\.id))
            var added = 0
            for row in rows {
                if let at = Self.operationTime(row.payload), known.insert(row.id).inserted {
                    local.ops.append(StoredOp(id: row.id, at: at, payload: row.payload, pushed: true))
                    added += 1
                } else if let index = local.ops.firstIndex(where: { $0.id == row.id }) {
                    local.ops[index].pushed = true   // 自己刚上传的，云端已确认
                }
            }
            if let last = rows.last { local.cursor = last.created_at }
            rebuild()
            if rows.count < 200 || added == 0 { return }
        }
    }

    static func operationTime(_ payload: String) -> Int64? {
        guard let object = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return nil }
        return (object["at"] as? NSNumber)?.int64Value
    }

    // MARK: 本机改动（先存本机，再上传）

    func setRead(_ item: LibraryItem, read: Bool) {
        let stamp = Int64((now().timeIntervalSince1970 * 1000).rounded())
        append(kind: "patch", url: item.url, patch: ["visitedAt": read ? stamp as Any : NSNull()])
    }

    func delete(_ item: LibraryItem) {
        append(kind: "delete", url: item.url, patch: [:])
    }

    private func append(kind: String, url: String, patch: [String: Any]) {
        let latest = local.ops.map(\.at).max() ?? 0
        let at = max(Int64((now().timeIntervalSince1970 * 1000).rounded()), latest + 1)
        let operation = LibraryOperation(id: UUID().uuidString.lowercased(), at: at, url: url, kind: kind, patch: patch)
        guard let payload = try? operation.serialized() else { return }
        local.ops.append(StoredOp(id: operation.id, at: at, payload: payload, pushed: false))
        persistence.save(local)
        rebuild()
        Task { await sync() }
    }

    func signedOut() {
        local = LocalLibrary()
        persistence.save(local)
        rebuild()
        syncState = .needsSignIn
    }

    private func rebuild() {
        items = LibraryMaterializer.materialize(local.ops)
    }
}
