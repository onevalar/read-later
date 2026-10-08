import Foundation

@MainActor
final class AccountModel: ObservableObject {
    @Published private(set) var session: Session?
    @Published var email = ""
    @Published var password = ""
    @Published var busy = false
    @Published var error = ""

    private let store: SessionStoring
    private let api: SupabaseAPI

    init(store: SessionStoring = KeychainSessionStore(), api: SupabaseAPI = SupabaseAPI()) {
        self.store = store
        self.api = api
        session = store.load()
    }

    /// 后台任务（快捷指令、同步）可能已经让登录失效或刷新，回到前台时同步一下。
    func reload() { session = store.load() }

    func signIn() async -> Bool {
        guard !email.isEmpty, !password.isEmpty else { return false }
        busy = true
        error = ""
        defer { busy = false }
        do {
            let next = try await api.signIn(email: email, password: password)
            store.save(next)
            password = ""
            session = next
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func signOut() {
        store.clear()
        session = nil
    }

    /// 在应用里手动保存一段文字里的链接（和快捷指令走同一套流程）。
    func save(text: String) async -> SaveOutcome {
        busy = true
        defer { busy = false }
        return await SaveLinkService(api: api, store: store).save(text: text)
    }
}
