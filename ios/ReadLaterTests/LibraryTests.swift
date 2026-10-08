import XCTest
@testable import ReadLater

private func op(_ id: String, at: Int64, kind: String, url: String, patch: [String: Any], pushed: Bool = true) -> StoredOp {
    let payload = try! LibraryOperation(id: id, at: at, url: url, kind: kind, patch: patch).serialized()
    return StoredOp(id: id, at: at, payload: payload, pushed: pushed)
}

private func create(_ id: String, at: Int64, url: String, title: String, text: String? = nil) -> StoredOp {
    op("op-" + id, at: at, kind: "create", url: url, patch: [
        "id": "page-" + id, "title": title, "favicon": NSNull(), "tags": [String](), "autoTags": [String](),
        "savedAt": at, "visitedAt": NSNull(), "notes": NSNull(), "articleText": text.map { $0 as Any } ?? NSNull(), "progress": NSNull(),
    ])
}

final class LibraryMaterializerTests: XCTestCase {
    func testReplaysCreatePatchAndDelete() {
        let items = LibraryMaterializer.materialize([
            op("p2", at: 5000, kind: "patch", url: "https://e.com/b", patch: ["title": "B 改名", "visitedAt": 5000]),
            create("a", at: 1000, url: "https://e.com/a", title: "A", text: "正文"),
            create("b", at: 2000, url: "https://e.com/b", title: "B"),
            create("c", at: 3000, url: "https://e.com/c", title: "C"),
            op("d", at: 6000, kind: "delete", url: "https://e.com/c", patch: [:]),
        ])
        XCTAssertEqual(items.map(\.title), ["B 改名", "A"])           // 新保存的在前，C 已删除
        XCTAssertTrue(items[0].isRead)
        XCTAssertFalse(items[1].isRead)
        XCTAssertEqual(items[1].articleText, "正文")
    }

    func testPatchWithNullClearsFieldAndOrphanPatchIsIgnored() {
        let items = LibraryMaterializer.materialize([
            create("a", at: 1000, url: "https://e.com/a", title: "A"),
            op("read", at: 2000, kind: "patch", url: "https://e.com/a", patch: ["visitedAt": 2000]),
            op("unread", at: 3000, kind: "patch", url: "https://e.com/a", patch: ["visitedAt": NSNull()]),
            op("orphan", at: 4000, kind: "patch", url: "https://e.com/zzz", patch: ["title": "不存在"]),
        ])
        XCTAssertEqual(items.count, 1)
        XCTAssertFalse(items[0].isRead)
    }

    func testDeletedLinkCanBeSavedAgain() {
        let items = LibraryMaterializer.materialize([
            create("a", at: 1000, url: "https://e.com/a", title: "旧"),
            op("d", at: 2000, kind: "delete", url: "https://e.com/a", patch: [:]),
            create("a2", at: 3000, url: "https://e.com/a", title: "新"),
        ])
        XCTAssertEqual(items.map(\.title), ["新"])
    }

    func testMetaHelpers() {
        let item = LibraryItem(id: "1", url: "https://www.example.com/x", title: "t", savedAt: 0, visitedAt: nil, notes: nil, progress: nil, articleText: String(repeating: "字", count: 1801))
        XCTAssertEqual(item.host, "example.com")
        XCTAssertEqual(item.initial, "E")
        XCTAssertEqual(LibraryItem(id: "2", url: "https://mp.weixin.qq.com/s/x", title: "", savedAt: 0, visitedAt: nil, notes: nil, progress: nil, articleText: nil).initial, "微")
        XCTAssertEqual(LibraryItem(id: "3", url: "https://m.maggieappleton.com/a", title: "", savedAt: 0, visitedAt: nil, notes: nil, progress: nil, articleText: nil).initial, "M")
        XCTAssertEqual(LibraryItem(id: "4", url: "https://mp.weixin.qq.com/s/x", title: "", savedAt: 0, visitedAt: nil, notes: nil, progress: nil, articleText: nil).siteName, "微信公众号")
        XCTAssertEqual(item.readingMinutes, 3)
    }

    func testDayLabelIsStaticText() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(DayLabel.text(for: now.addingTimeInterval(-3600), now: now, calendar: calendar), "今天")
        XCTAssertEqual(DayLabel.text(for: now.addingTimeInterval(-86_400), now: now, calendar: calendar), "昨天")
        XCTAssertTrue(DayLabel.text(for: now.addingTimeInterval(-86_400 * 5), now: now, calendar: calendar).contains("月"))
    }
}

@MainActor
final class LibraryModelTests: XCTestCase {
    private let fixedNow = Date(timeIntervalSince1970: 1_790_000_000)
    private var session: Session { Session(accessToken: "a", refreshToken: "r", expiresAt: fixedNow.addingTimeInterval(3600), userId: "user-1", email: "me@example.com") }
    override func setUp() { StubURLProtocol.reset() }

    private func model(persistence: MemoryPersistence = MemoryPersistence(), signedIn: Bool = true) -> LibraryModel {
        LibraryModel(persistence: persistence, api: SupabaseAPI(urlSession: StubURLProtocol.session()), store: MemorySessionStore(signedIn ? session : nil), now: { self.fixedNow })
    }

    private func row(_ stored: StoredOp, createdAt: String) -> [String: String] { ["id": stored.id, "created_at": createdAt, "payload": stored.payload] }

    func testPullBuildsLibraryFromCloudAndKeepsCursor() async {
        let first = create("a", at: 1000, url: "https://e.com/a", title: "来自电脑")
        let second = create("b", at: 2000, url: "https://mp.weixin.qq.com/s/x", title: "来自微信", text: "正文")
        StubURLProtocol.handler = { _, _ in
            (200, try! JSONSerialization.data(withJSONObject: [self.row(first, createdAt: "2026-10-09T01:00:00.100000+00:00"), self.row(second, createdAt: "2026-10-09T01:00:05.200000+00:00")]))
        }
        let persistence = MemoryPersistence()
        let library = model(persistence: persistence)
        await library.sync()
        XCTAssertEqual(library.items.map(\.title), ["来自微信", "来自电脑"])
        XCTAssertEqual(library.syncState, .synced(fixedNow))
        XCTAssertEqual(persistence.library.cursor, "2026-10-09T01:00:05.200000+00:00")
        XCTAssertEqual(persistence.library.userId, "user-1")
    }

    func testMarkReadIsSavedLocallyThenPushedToCloud() async throws {
        let seed = MemoryPersistence()
        seed.library = LocalLibrary(userId: "user-1", ops: [create("a", at: 1000, url: "https://e.com/a", title: "A")], cursor: nil, lastSyncedAt: nil)
        var posted: [String] = []
        StubURLProtocol.handler = { request, body in
            if request.httpMethod == "POST", let body, let rows = (try? JSONSerialization.jsonObject(with: body)) as? [[String: String]] {
                posted += rows.compactMap { $0["payload"] }
                return (201, Data())
            }
            return (200, Data("[]".utf8))
        }
        let library = model(persistence: seed)
        library.setRead(try XCTUnwrap(library.items.first), read: true)
        XCTAssertTrue(library.items[0].isRead)               // 立刻生效，不用等网络
        XCTAssertEqual(library.pendingCount, 1)
        await library.sync()
        XCTAssertEqual(library.pendingCount, 0)
        XCTAssertEqual(posted.count, 1)
        XCTAssertTrue(posted[0].contains("\"visitedAt\":"))
        XCTAssertEqual(library.syncState, .synced(fixedNow))
    }

    func testOfflineKeepsChangeAndShowsPending() async throws {
        let seed = MemoryPersistence()
        seed.library = LocalLibrary(userId: "user-1", ops: [create("a", at: 1000, url: "https://e.com/a", title: "A")], cursor: nil, lastSyncedAt: nil)
        StubURLProtocol.handler = nil   // 任何请求都得到 500 → 当作失败
        let library = model(persistence: seed)
        library.delete(try XCTUnwrap(library.items.first))
        XCTAssertTrue(library.items.isEmpty)
        await library.sync()
        XCTAssertEqual(library.pendingCount, 1)             // 没上传成功，改动仍保留
        if case .failed = library.syncState {} else if case .pending = library.syncState {} else { XCTFail("应当提示同步未完成") }
    }

    func testSignedOutShowsPromptAndDifferentAccountResetsLocalCopy() async {
        let signedOut = model(signedIn: false)
        await signedOut.sync()
        XCTAssertEqual(signedOut.syncState, .needsSignIn)

        let seed = MemoryPersistence()
        seed.library = LocalLibrary(userId: "someone-else", ops: [create("a", at: 1000, url: "https://e.com/a", title: "别人的")], cursor: "x", lastSyncedAt: nil)
        StubURLProtocol.handler = { _, _ in (200, Data("[]".utf8)) }
        let library = model(persistence: seed)
        await library.sync()
        XCTAssertTrue(library.items.isEmpty)               // 换账号后不会混入上一个账号的内容
    }
}
