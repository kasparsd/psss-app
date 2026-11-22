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

    /// Visits this node and every descendant in document order.
    func walk(_ visit: (XNode) -> Void) {
        visit(self)
        for child in children { child.walk(visit) }
    }
}

enum XMLTree {
    struct ParseError: Error { var message: String }

    private static let maxDepth = 64
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

    static func serialize(_ root: XNode) -> Data {
        var out = "<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>\n"
        write(root, depth: 0, into: &out)
        return Data(out.utf8)
    }

    private static func write(_ node: XNode, depth: Int, into out: inout String) {
        let indent = String(repeating: "\t", count: depth)
        out += indent + "<" + node.name
        for (name, value) in node.attributes { out += " \(name)=\"\(escape(value, attribute: true))\"" }
        if node.children.isEmpty {
            out += node.text.isEmpty ? "/>\n" : ">" + escape(node.text, attribute: false) + "</\(node.name)>\n"
        } else {
            out += ">\n"
            for child in node.children { write(child, depth: depth + 1, into: &out) }
            out += indent + "</\(node.name)>\n"
        }
    }

    private static func escape(_ text: String, attribute: Bool) -> String {
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
                // XML 1.0 cannot hold most control characters. Drop them instead of writing a file nobody can open.
                if scalar.value < 0x20 && scalar != "\n" && scalar != "\t" { continue }
                result.unicodeScalars.append(scalar)
            }
        }
        return result
    }
}
