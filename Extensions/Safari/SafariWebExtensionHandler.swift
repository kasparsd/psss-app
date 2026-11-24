import SafariServices

/// Receives the extension's native messages in Safari. It answers the same protocol as the native
/// messaging host that Chrome and Firefox use, through the shared `BrowserProtocol`. Safari ignores
/// the host name the extension passes and always delivers to this app extension. Only background
/// scripts and extension pages can reach it, which is where the popup runs.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        // The vault list is read from the App Group. This process never holds a key and cannot reach the app yet, so it lists
        // every vault locked, cannot switch, and answers an unlock with `needs-app` (see `StoredVaultService`).
        BrowserProtocol.vaultService = StoredVaultService()
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let reply = message.map(BrowserProtocol.handle)
            ?? ["v": BrowserProtocol.version, "id": "", "ok": false, "error": "unsupported"]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response])
    }
}
