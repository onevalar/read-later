import XCTest
@testable import ReadLater

final class SaveLinkServiceTests: XCTestCase {
    private let fixedNow = Date(timeIntervalSince1970: 1_790_000_000)
    private func session(expired: Bool = false) -> Session {
        Session(accessToken: "access-1", refreshToken: "refresh-1", expiresAt: fixedNow.addingTimeInterval(expired ? -10 : 3600), userId: "user-1", email: "me@example.com")
    }
    private func service(store: MemorySessionStore, article: Article?) -> SaveLinkService {
        var ids = 0
        return SaveLinkService(api: SupabaseAPI(urlSession: StubURLProtocol.session()), store: store, fetcher: FakeFetcher(article: article),
                               now: { self.fixedNow }, makeID: { ids += 1; return "id-\(ids)" })
    }
    override func setUp() { StubURLProtocol.reset() }

    /// 模拟云端：POST 会记住记录，之后的 GET 能读到，和真实云端的行为一致。
    private func fakeCloud(initial: [String] = [], tokenReply: Data? = nil, rejectFirstPost: Bool = false) {
        var stored = initial
        var posts = 0
        StubURLProtocol.handler = { request, body in
            if request.url?.path.hasSuffix("/auth/v1/token") == true, let reply = tokenReply { return (200, reply) }
            if request.httpMethod == "POST" {
                posts += 1
                if rejectFirstPost && posts == 1 { return (401, Data("{}".utf8)) }
                if let body, let rows = (try? JSONSerialization.jsonObject(with: body)) as? [[String: String]] { stored += rows.compactMap { $0["payload"] } }
                return (201, Data())
            }
            return (200, try! JSONSerialization.data(withJSONObject: stored.map { ["payload": $0] }))
        }
    }
    private let tokenReply = Data("{\"access_token\":\"access-2\",\"refresh_token\":\"refresh-2\",\"expires_in\":3600,\"user\":{\"id\":\"user-1\",\"email\":\"me@example.com\"}}".utf8)

    func testSavesNewLinkAfterDuplicateCheck() async throws {
        fakeCloud()
        let outcome = await service(store: MemorySessionStore(session()), article: Article(title: "好文章", text: "正文"))
            .save(text: "https://mp.weixin.qq.com/s/abc")
        XCTAssertEqual(outcome, .saved(title: "好文章", hasText: true))
        let requests = StubURLProtocol.requests
        XCTAssertEqual(requests.map { $0.0.httpMethod }, ["GET", "POST", "GET"])   // 查重 → 写入 → 读回确认
        let post = try XCTUnwrap(requests.first { $0.0.httpMethod == "POST" })
        XCTAssertEqual(post.0.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(post.1)) as? [[String: String]])
        XCTAssertEqual(rows.first?["user_id"], "user-1")
        let payload = try XCTUnwrap(rows.first?["payload"])
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any])
        XCTAssertEqual(object["kind"] as? String, "create")
        XCTAssertEqual(object["id"] as? String, rows.first?["id"])
    }

    func testSkipsLinkAlreadyInLibrary() async {
        let existing = "{\"at\":1,\"id\":\"old\",\"kind\":\"create\",\"patch\":{},\"url\":\"https://example.com/a\"}"
        StubURLProtocol.handler = { _, _ in (200, try! JSONSerialization.data(withJSONObject: [["payload": existing]])) }
        let outcome = await service(store: MemorySessionStore(session()), article: Article(title: "x", text: nil)).save(text: "https://example.com/a")
        XCTAssertEqual(outcome, .duplicate)
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }

    func testSavesAgainWhenLastOperationWasDelete() async {
        let create = "{\"at\":1,\"id\":\"a\",\"kind\":\"create\",\"patch\":{},\"url\":\"https://example.com/a\"}"
        let delete = "{\"at\":2,\"id\":\"b\",\"kind\":\"delete\",\"patch\":{},\"url\":\"https://example.com/a\"}"
        fakeCloud(initial: [create, delete])
        let outcome = await service(store: MemorySessionStore(session()), article: nil).save(text: "https://example.com/a")
        XCTAssertEqual(outcome, .saved(title: "https://example.com/a", hasText: false))
    }

    func testRefreshesExpiredSessionFirst() async {
        fakeCloud(tokenReply: tokenReply)
        let store = MemorySessionStore(session(expired: true))
        let outcome = await service(store: store, article: Article(title: "t", text: nil)).save(text: "https://example.com/p")
        XCTAssertEqual(outcome, .saved(title: "t", hasText: false))
        XCTAssertEqual(store.value?.accessToken, "access-2")
        XCTAssertEqual(StubURLProtocol.requests.last?.0.value(forHTTPHeaderField: "Authorization"), "Bearer access-2")
    }

    func testRetriesOnceWhenServerRejectsToken() async {
        fakeCloud(tokenReply: tokenReply, rejectFirstPost: true)
        let outcome = await service(store: MemorySessionStore(session()), article: Article(title: "t", text: nil)).save(text: "https://example.com/p")
        XCTAssertEqual(outcome, .saved(title: "t", hasText: false))
        XCTAssertEqual(StubURLProtocol.requests.filter { $0.0.httpMethod == "POST" && $0.0.url?.path.contains("reading_operations") == true }.count, 2)
    }

    func testDoesNotReportSuccessWhenCloudDoesNotConfirm() async {
        StubURLProtocol.handler = { request, _ in request.httpMethod == "GET" ? (200, Data("[]".utf8)) : (201, Data()) }
        let outcome = await service(store: MemorySessionStore(session()), article: nil).save(text: "https://example.com/p")
        guard case .failed = outcome else { return XCTFail("云端没有确认时不能提示已保存") }
    }

    func testNeedsSignInAndNeedsLink() async {
        let signedOut = service(store: MemorySessionStore(nil), article: nil)
        let a = await signedOut.save(text: "https://example.com")
        XCTAssertEqual(a, .notSignedIn)
        let b = await service(store: MemorySessionStore(session()), article: nil).save(text: "没有链接")
        XCTAssertEqual(b, .noLink)
        XCTAssertTrue(StubURLProtocol.requests.isEmpty)
    }

    func testReportsServerFailure() async {
        StubURLProtocol.handler = { request, _ in
            request.httpMethod == "GET" ? (200, Data("[]".utf8)) : (500, Data("{\"message\":\"boom\"}".utf8))
        }
        let outcome = await service(store: MemorySessionStore(session()), article: nil).save(text: "https://example.com/p")
        guard case .failed(let reason) = outcome else { return XCTFail("应当失败") }
        XCTAssertTrue(reason.contains("boom"))
    }
}
