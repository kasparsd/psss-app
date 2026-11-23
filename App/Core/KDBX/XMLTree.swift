import Foundation

/// A small mutable XML tree. The KDBX document is edited in place so every element this app does not understand
/// (icons, auto-type, custom data, history, other apps' fields) survives a save untouched.
/// Not thread-safe: a tree belongs to one owner at a time and moves between tasks only whole, with its document.
final class XNode: @unchecked Sendable {
    var name: String
    var attributes: [(name: String, value: String)]
    var children: [XNode]
    /// Text of a leaf element. Containers carry no text.
    var text: String

    init(_ name: String, text: String = "", attributes: [(name: String, value: String)] = [], children: [XNode] = []) {
        self.name = name
        self.text = text
        self.attributes = attributes
        self.children = children
    }

    func attribute(_ key: String) -> String? { attributes.first { $0.name == key }?.value }

    func setAttribute(_ key: String, _ value: String?) {
        attributes.removeAll { $0.name == key }
        if let value { attributes.append((key, value)) }
    }

    func child(_ name: String) -> XNode? { children.first { $0.name == name } }
    func children(named name: String) -> [XNode] { children.filter { $0.name == name } }

    /// The child's text, creating the child at the end when missing.
    func setChildText(_ name: String, _ value: String) {
        if let existing = child(name) { existing.text = value } else { children.append(XNode(name, text: value)) }
    }

    func deepCopy() -> XNode {
        XNode(name, text: text, attributes: attributes, children: children.map { $0.deepCopy() })
    }

    /// Whether both trees have the same names, attributes (in any order), text and children, in order.
    func isEqual(to other: XNode) -> Bool {
        guard name == other.name, text == other.text, children.count == other.children.count,
              attributes.count == other.attributes.count,
              attributes.allSatisfy({ attribute in other.attributes.contains { $0.name == attribute.name && $0.value == attribute.value } })
        else { return false }
        return zip(children, other.children).allSatisfy { $0.isEqual(to: $1) }
    }

    /// Visits this node and every descendant in document order.
    func walk(_ visit: (XNode) -> Void) {
        visit(self)
        for child in children { child.walk(visit) }
    }
}

enum XMLTree {
    struct ParseError: Error { var message: String }

    /// How deeply elements may nest. A file nested deeper does not open, so a writer must not make one.
    static let maxDepth = 64
    private static let maxNodes = 5_000_000

    static func parse(_ data: Data) throws -> XNode {
        let delegate = Builder()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = false
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse(), let root = delegate.root, delegate.failure == nil else {
            throw ParseError(message: delegate.failure ?? parser.parserError?.localizedDescription ?? "Invalid XML")
        }
        return root
    }

    private final class Builder: NSObject, XMLParserDelegate {
        var root: XNode?
        var failure: String?
        private var stack: [XNode] = []
        private var buffer = ""
        private var count = 0

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?,
                    attributes attributeDict: [String: String] = [:]) {
            count += 1
            guard stack.count < XMLTree.maxDepth, count < XMLTree.maxNodes else {
                failure = "The document is nested or large beyond the supported limits."
                parser.abortParsing()
                return
            }
            let node = XNode(elementName, attributes: attributeDict.sorted { $0.key < $1.key }.map { ($0.key, $0.value) })
            if let parent = stack.last { parent.children.append(node) } else { root = node }
            stack.append(node)
            buffer = ""
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) { buffer += string }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
            guard let node = stack.popLast() else { return }
            // Pretty-printing whitespace between child elements is not content.
            if node.children.isEmpty { node.text = buffer }
            buffer = ""
        }
    }

    /// The document as XML text. `protect`, when given, turns the text of every protected `Value` element into what is written
    /// for it, in document order: the inner stream cipher runs inline, so no copy of the tree is needed.
    static func serialize(_ root: XNode, protect: ((String) -> String)? = nil) -> Data {
        var out = "<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>\n"
        write(root, depth: 0, into: &out, protect: protect)
        return Data(out.utf8)
    }

    private static let tabs = (0...(maxDepth + 2)).map { String(repeating: "\t", count: $0) }

    private static func write(_ node: XNode, depth: Int, into out: inout String, protect: ((String) -> String)?) {
        let indent = depth < tabs.count ? tabs[depth] : String(repeating: "\t", count: depth)
        out += indent
        out += "<"
        out += node.name
        for (name, value) in node.attributes {
            out += " "; out += name; out += "=\""; out += escape(value, attribute: true); out += "\""
        }
        if node.children.isEmpty {
            var text = node.text
            if let protect, node.name == "Value", node.attribute("Protected")?.lowercased() == "true" { text = protect(text) }
            if text.isEmpty { out += "/>\n" } else {
                out += ">"; out += escape(text, attribute: false); out += "</"; out += node.name; out += ">\n"
            }
        } else {
            // A container carries no text, but a protected one still takes its (empty) turn in the stream.
            if let protect, node.name == "Value", node.attribute("Protected")?.lowercased() == "true" { _ = protect("") }
            out += ">\n"
            for child in node.children { write(child, depth: depth + 1, into: &out, protect: protect) }
            out += indent; out += "</"; out += node.name; out += ">\n"
        }
    }

    /// Whether XML 1.0 can hold the character: #x9, #xA, #xD, #x20-#xD7FF, #xE000-#xFFFD and #x10000-#x10FFFF. Swift scalars are
    /// never surrogates, so that range needs no check. U+FFFE and U+FFFF are the ones that look harmless and are not.
    static func isStorable(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x9, 0xA, 0xD, 0x20...0xD7FF, 0xE000...0xFFFD, 0x10000...0x10FFFF: return true
        default: return false
        }
    }

    /// The text as the writer stores it: every character XML 1.0 cannot hold is dropped (control characters other than tab,
    /// line feed and carriage return, U+FFFE and U+FFFF). Dropping them, and not replacing them, keeps a pasted value
    /// readable and keeps the stored text a prefix-compatible form of what was typed. Importers use this to decide what is
    /// storable before they compare names, so two names that differ only by a dropped character are one name.
    static func storable(_ text: String) -> String {
        text.unicodeScalars.allSatisfy(isStorable) ? text : String(String.UnicodeScalarView(text.unicodeScalars.filter(isStorable)))
    }

    private static func escape(_ text: String, attribute: Bool) -> String {
        // Most text is plain printable ASCII with nothing to escape.
        if text.utf8.allSatisfy({ $0 >= 0x20 && $0 < 0x7F && $0 != 0x26 && $0 != 0x3C && $0 != 0x3E && $0 != 0x22 }) { return text }
        var result = ""
        result.reserveCapacity(text.count)
        for scalar in text.unicodeScalars {
            switch scalar {
            case "&": result += "&amp;"
            case "<": result += "&lt;"
            case ">": result += "&gt;"
            case "\"" where attribute: result += "&quot;"
            case "\n" where attribute: result += "&#10;"
            case "\r": result += "&#13;"
            case "\t" where attribute: result += "&#9;"
            default:
                // Anything XML 1.0 cannot hold is dropped, so the file can always be read again.
                if !isStorable(scalar) { continue }
                result.unicodeScalars.append(scalar)
            }
        }
        return result
    }
}
