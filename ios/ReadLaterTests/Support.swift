import Foundation
@testable import ReadLater

final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest, Data?) -> (Int, Data))?
    nonisolated(unsafe) static var requests: [(URLRequest, Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 4096)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            buffer.deallocate()
            stream.close()
            body = data
        }
        Self.requests.append((request, body))
        let (status, data) = Self.handler?(request, body) ?? (500, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }
    static func reset() { handler = nil; requests = [] }
}

final class MemorySessionStore: SessionStoring {
    var value: Session?
    init(_ value: Session? = nil) { self.value = value }
    func load() -> Session? { value }
    func save(_ session: Session) { value = session }
    func clear() { value = nil }
}

final class MemoryPersistence: LibraryPersisting {
    var library = LocalLibrary()
    func load() -> LocalLibrary { library }
    func save(_ library: LocalLibrary) { self.library = library }
}

struct FakeFetcher: ArticleFetching {
    var article: Article?
    func fetch(_ url: URL) async -> Article? { article }
}
