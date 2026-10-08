import Foundation

/// 统一处理登录有效期：快过期先刷新；云端返回"登录失效"时刷新一次再重试。
struct CloudAccess {
    var api: SupabaseAPI
    var store: SessionStoring
    var now: () -> Date = Date.init

    func perform<T>(_ body: (Session) async throws -> T) async throws -> T {
        guard var session = store.load() else { throw SaveError.notSignedIn }
        if session.isExpired(now: now()) { session = try await refresh(session) }
        do {
            return try await body(session)
        } catch SaveError.auth(let message) where message == "expired" {
            session = try await refresh(session)
            return try await body(session)
        }
    }

    private func refresh(_ session: Session) async throws -> Session {
        let next = try await api.refresh(session, now: now())
        store.save(next)
        return next
    }
}
