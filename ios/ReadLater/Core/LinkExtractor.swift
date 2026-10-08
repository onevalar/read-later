import Foundation

struct Article: Equatable {
    var title: String
    var text: String?
}

protocol ArticleFetching {
    func fetch(_ url: URL) async -> Article?
}

/// 从剪贴板文字里找出第一个 http/https 链接；从网页里取标题和正文。
enum LinkExtractor {
    static func firstURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        for match in detector.matches(in: text, options: [], range: range) {
            if let url = match.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") { return url }
        }
        return nil
    }

    // MARK: - 网页解析

    static func parse(html: String, url: URL) -> Article? {
        if isVerificationPage(html) { return nil }
        let isWeChat = url.host?.hasSuffix("mp.weixin.qq.com") == true
        let title = (isWeChat ? weChatTitle(in: html) : nil) ?? metaContent(html, property: "og:title") ?? tagText(html, tag: "title")
        guard let title, !title.isEmpty else { return nil }
        var text: String?
        if isWeChat {
            text = divInnerHTML(html, id: "js_content").map(plainText)
        } else {
            text = tagInner(html, tag: "article").map(plainText)
        }
        if let value = text, value.count < 80 { text = nil }   // 太短多半不是正文
        return Article(title: decodeEntities(title).trimmingCharacters(in: .whitespacesAndNewlines), text: text.map { String($0.prefix(100_000)) })
    }

    /// 微信对不在微信里的访问有时会返回"环境异常"验证页，这时拿不到正文。
    static func isVerificationPage(_ html: String) -> Bool {
        html.contains("wappoc_appmsgcaptcha") || (html.contains("环境异常") && html.contains("去验证"))
    }

    private static func weChatTitle(in html: String) -> String? {
        if let value = firstMatch(html, pattern: #"var\s+msg_title\s*=\s*'([^']*)'"#) { return value.replacingOccurrences(of: "\\x26", with: "&") }
        if let value = firstMatch(html, pattern: #"id="activity-name"[^>]*>\s*([^<]+?)\s*<"#) { return value }
        return metaContent(html, property: "og:title")
    }

    private static func metaContent(_ html: String, property: String) -> String? {
        let escaped = NSRegularExpression.escapedPattern(for: property)
        return firstMatch(html, pattern: #"<meta[^>]+property=["']"# + escaped + #"["'][^>]*content=["']([^"']*)["']"#)
            ?? firstMatch(html, pattern: #"<meta[^>]+content=["']([^"']*)["'][^>]*property=["']"# + escaped + #"["']"#)
    }

    private static func tagText(_ html: String, tag: String) -> String? {
        firstMatch(html, pattern: "<" + tag + #"[^>]*>([^<]*)</"# + tag + ">")
    }

    private static func tagInner(_ html: String, tag: String) -> String? {
        guard let open = html.range(of: "<" + tag, options: .caseInsensitive),
              let start = html[open.upperBound...].firstIndex(of: ">"),
              let close = html.range(of: "</" + tag + ">", options: .caseInsensitive, range: start..<html.endIndex) else { return nil }
        return String(html[html.index(after: start)..<close.lowerBound])
    }

    /// 取指定 id 的 div 里面的内容，按 div 嵌套层数找到配对的结束标签。
    static func divInnerHTML(_ html: String, id: String) -> String? {
        guard let idRange = html.range(of: "id=\"" + id + "\""),
              let tagEnd = html[idRange.upperBound...].firstIndex(of: ">") else { return nil }
        let bodyStart = html.index(after: tagEnd)
        var depth = 1
        var cursor = bodyStart
        while let lt = html[cursor...].firstIndex(of: "<") {
            let rest = html[lt...]
            if rest.hasPrefix("</div") {
                depth -= 1
                if depth == 0 { return String(html[bodyStart..<lt]) }
            } else if rest.hasPrefix("<div") {
                depth += 1
            }
            cursor = html.index(after: lt)
        }
        return String(html[bodyStart...])
    }

    static func plainText(_ html: String) -> String {
        var text = html
        for (pattern, replacement) in [
            (#"(?is)<(script|style)[^>]*>.*?</\1>"#, ""),
            (#"(?i)<br\s*/?>"#, "\n"),
            (#"(?i)</(p|section|div|h[1-6]|li|blockquote)>"#, "\n"),
            (#"<[^>]+>"#, ""),
        ] {
            text = text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        text = decodeEntities(text)
        let lines = text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return lines.joined(separator: "\n")
    }

    static func decodeEntities(_ text: String) -> String {
        var result = text
        let named = ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'"]
        for (entity, value) in named { result = result.replacingOccurrences(of: entity, with: value) }
        guard let regex = try? NSRegularExpression(pattern: #"&#(x?)([0-9a-fA-F]+);"#) else { return result }
        let matches = regex.matches(in: result, range: NSRange(result.startIndex..., in: result)).reversed()
        for match in matches {
            guard let whole = Range(match.range, in: result), let hex = Range(match.range(at: 1), in: result), let digits = Range(match.range(at: 2), in: result),
                  let code = UInt32(result[digits], radix: result[hex].isEmpty ? 10 : 16), let scalar = Unicode.Scalar(code) else { continue }
            result.replaceSubrange(whole, with: String(Character(scalar)))
        }
        return result
    }

    private static func firstMatch(_ html: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: html) else { return nil }
        return String(html[range])
    }
}

/// 用手机自己的网络下载网页，不经过任何服务器，所以不会被当成"机器抓取"。
struct WebArticleFetcher: ArticleFetching {
    var urlSession: URLSession = .shared
    static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

    func fetch(_ url: URL) async -> Article? {
        var request = URLRequest(url: url, timeoutInterval: 12)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        guard let (data, response) = try? await urlSession.data(for: request),
              (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) ?? false,
              let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return nil }
        return LinkExtractor.parse(html: html, url: response.url ?? url)
    }
}
