import Foundation
import ImageIO
import Vision

/// Reads QR codes out of an image on this device. The image is never stored or sent anywhere.
enum QRDecoder {
    /// The text of every QR code found in encoded image data (PNG, JPEG, HEIC, TIFF).
    static func payloads(in data: Data) -> [String] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return [] }
        return payloads(in: image)
    }

    static func payloads(in image: CGImage) -> [String] {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        guard (try? handler.perform([request])) != nil else { return [] }
        return (request.results ?? []).compactMap { $0.payloadStringValue }
    }
}
