import Foundation
import Security

struct Session: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String

    /// 提前一分钟视为过期，避免请求发出去时刚好失效。
    func isExpired(now: Date = Date()) -> Bool { expiresAt.timeIntervalSince(now) < 60 }
}

protocol SessionStoring {
    func load() -> Session?
    func save(_ session: Session)
    func clear()
}

/// 登录会话放在钥匙串里。AfterFirstUnlock：手机锁屏但已解锁过一次时，快捷指令也能读到。
struct KeychainSessionStore: SessionStoring {
    private let service = "com.onevalar.readlater.session"
    private let account = "supabase"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func load() -> Session? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    func save(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    func clear() { SecItemDelete(query as CFDictionary) }
}
