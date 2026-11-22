import Foundation

/// Strong passwords in a form that is easy to read and type: three groups of six, with at least
/// one capital, one lowercase letter and one digit. Site password rules are not applied yet.
enum PasswordGenerator {
    static func strong() -> String {
        let lower = Array("abcdefghjkmnpqrstuvwxyz")
        let upper = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
        let digits = Array("23456789")
        let all = lower + upper + digits
        var characters = (0..<18).map { _ in all.randomElement()! }
        characters[Int.random(in: 0..<18)] = upper.randomElement()!
        var index = Int.random(in: 0..<18)
        characters[index] = lower.randomElement()!
        repeat { index = Int.random(in: 0..<18) } while characters[index].isUppercase
        characters[index] = digits.randomElement()!
        let text = String(characters)
        return stride(from: 0, to: 18, by: 6).map { String(text.dropFirst($0).prefix(6)) }.joined(separator: "-")
    }

    static func alphanumeric() -> String {
        let all = Array("abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<20).map { _ in all.randomElement()! })
    }
}
