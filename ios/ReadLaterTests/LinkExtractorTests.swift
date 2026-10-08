import XCTest
@testable import ReadLater

final class LinkExtractorTests: XCTestCase {
    func testFindsLinkInPlainAndWrappedText() {
        XCTAssertEqual(LinkExtractor.firstURL(in: "https://mp.weixin.qq.com/s/AbC123")?.absoluteString, "https://mp.weixin.qq.com/s/AbC123")
        XCTAssertEqual(LinkExtractor.firstURL(in: "看看这篇 https://example.com/a?b=1 很不错")?.absoluteString, "https://example.com/a?b=1")
        XCTAssertNil(LinkExtractor.firstURL(in: "没有链接的文字"))
        XCTAssertNil(LinkExtractor.firstURL(in: "mailto:a@b.com"))
    }

    func testParsesWeChatArticle() throws {
        let body = String(repeating: "为安静留出空间，好的阅读体验让注意力回到文字本身。", count: 6)
        let html = """
        <html><head><meta property="og:title" content="备用标题"/><script>var msg_title = 'Designing for a quieter web';</script></head>
        <body><div id="img-content"><div id="js_content" style="visibility: hidden;">
        <section><p>第一段&nbsp;&amp;内容</p><p>\(body)</p><div><p>嵌套块</p></div></section></div><script>var x=1;</script></div></body></html>
        """
        let article = try XCTUnwrap(LinkExtractor.parse(html: html, url: URL(string: "https://mp.weixin.qq.com/s/x")!))
        XCTAssertEqual(article.title, "Designing for a quieter web")
        let text = try XCTUnwrap(article.text)
        XCTAssertTrue(text.contains("第一段 &内容"))
        XCTAssertTrue(text.contains("嵌套块"))
        XCTAssertFalse(text.contains("var x"))
    }

    func testVerificationPageIsNotAnArticle() {
        let html = "<html><body>当前环境异常，完成验证后即可继续访问<a href='/mp/wappoc_appmsgcaptcha'>去验证</a></body></html>"
        XCTAssertNil(LinkExtractor.parse(html: html, url: URL(string: "https://mp.weixin.qq.com/s/x")!))
    }

    func testGenericPageUsesOpenGraphTitleAndArticle() throws {
        let text = String(repeating: "A quiet web needs patient readers. ", count: 6)
        let html = "<html><head><meta property=\"og:title\" content=\"Hello &amp; welcome\"></head><body><article><p>\(text)</p></article></body></html>"
        let article = try XCTUnwrap(LinkExtractor.parse(html: html, url: URL(string: "https://example.com/post")!))
        XCTAssertEqual(article.title, "Hello & welcome")
        XCTAssertNotNil(article.text)
    }
}
