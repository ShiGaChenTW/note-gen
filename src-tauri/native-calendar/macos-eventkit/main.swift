// Fork (D2): read-only macOS Calendar bridge for the Today page.
// Input (stdin JSON):  { "action": "events" | "request", "start": <ms>, "end": <ms> }
// Output (stdout JSON): { "access": "...", "events": [ { id, title, start, end, allDay, calendar } ] }
// "request" asks for access first (shows the system prompt once), then returns events.
import EventKit
import Foundation

struct CalendarInput: Decodable {
    let action: String
    let start: Double
    let end: Double
}

struct CalendarEventOutput: Encodable {
    let id: String
    let title: String
    let start: Double
    let end: Double
    let allDay: Bool
    let calendar: String
}

struct CalendarOutput: Encodable {
    let access: String
    let events: [CalendarEventOutput]
}

func accessName(_ status: EKAuthorizationStatus) -> String {
    if #available(macOS 14.0, *) {
        switch status {
        case .fullAccess: return "granted"
        case .writeOnly: return "denied"
        default: break
        }
    }
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    default: return "granted"
    }
}

func requestAccess(_ store: EKEventStore) {
    let done = DispatchSemaphore(value: 0)
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, _ in done.signal() }
    } else {
        store.requestAccess(to: .event) { _, _ in done.signal() }
    }
    _ = done.wait(timeout: .now() + 120)
}

func write(_ output: CalendarOutput) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(output) {
        FileHandle.standardOutput.write(data)
    }
}

let inputData = FileHandle.standardInput.readDataToEndOfFile()
guard let input = try? JSONDecoder().decode(CalendarInput.self, from: inputData) else {
    FileHandle.standardError.write("Invalid calendar input\n".data(using: .utf8)!)
    exit(2)
}

let store = EKEventStore()
if input.action == "request" && EKEventStore.authorizationStatus(for: .event) == .notDetermined {
    requestAccess(store)
}

let access = accessName(EKEventStore.authorizationStatus(for: .event))
guard access == "granted" else {
    write(CalendarOutput(access: access, events: []))
    exit(0)
}

let startDate = Date(timeIntervalSince1970: input.start / 1000)
let endDate = Date(timeIntervalSince1970: input.end / 1000)
let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
let events = store.events(matching: predicate)
    .filter { $0.status != .canceled }
    .map { event in
        CalendarEventOutput(
            id: event.eventIdentifier ?? UUID().uuidString,
            title: event.title ?? "",
            start: event.startDate.timeIntervalSince1970 * 1000,
            end: event.endDate.timeIntervalSince1970 * 1000,
            allDay: event.isAllDay,
            calendar: event.calendar?.title ?? ""
        )
    }
    .sorted { $0.start < $1.start }

write(CalendarOutput(access: access, events: events))
