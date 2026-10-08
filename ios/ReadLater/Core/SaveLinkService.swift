import Foundation

enum SaveOutcome: Equatable {
    case saved(title: String, hasText: Bool)
    case duplicate
    case noLink
    case notSignedIn
    case failed(String)

    /// 显示在快捷指令结果气泡里的一句话。
    var message: String {
        switch self {
        case .saved(let title, let hasText): return hasText ? "已保存：\(title)" : "已保存链接：\(title)（正文稍后补全）"
        case .duplicate: return "这篇已经在阅读库里了"
        case .noLink: return "没有在剪贴板里找到网页链接"
        case .notSignedIn: return "还没登录，请先打开 Read Later 登录"
        case .failed(let reason): return "保存失败：\(reason)"
        }
    }
}

/// 保存的完整流程：找链接 → 查重 → 下载网页 → 追加一条记录 → 读回确认。
struct SaveLinkService {
    var api = SupabaseAPI()
    var store: SessionStoring = KeychainSessionStore()
    var fetcher: ArticleFetching = WebArticleFetcher()
    var now: () -> Date = Date.init
    var makeID: () -> String = { UUID().uuidString.lowercased() }

    private var access: CloudAccess { CloudAccess(api: api, store: store, now: now) }

    func save(text: String) async -> SaveOutcome {
        guard let url = LinkExtractor.firstURL(in: text) else { return .noLink }
        guard store.load() != nil else { return .notSignedIn }
        do {
            if try await access.perform({ try await api.isLinkInLibrary(url, session: $0) }) { return .duplicate }

            let article = await fetcher.fetch(url)
            let title = article?.title ?? url.absoluteString
            let operation = LibraryOperation.create(pageId: "page-" + makeID(), operationId: makeID(), url: url, title: title,
                                                    articleText: article?.text, savedAt: now(), autoTags: Self.autoTags(for: url))
            try await access.perform { try await api.append(operation, session: $0) }
            // 写入后再读一次：云端确认收到才算保存成功，避免"提示成功但其实没存上"。
            guard try await access.perform({ try await api.isLinkInLibrary(url, session: $0) }) else { return .failed("云端没有确认收到，请重试") }
            return .saved(title: title, hasText: article?.text != nil)
        } catch SaveError.notSignedIn {
            return .notSignedIn
        } catch SaveError.auth(let message) {
            store.clear()
            return message == "expired" ? .notSignedIn : .failed(message)
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    static func autoTags(for url: URL) -> [String] {
        url.host?.hasSuffix("mp.weixin.qq.com") == true ? ["📝 Article"] : ["🌐 Web Page"]
    }
}
