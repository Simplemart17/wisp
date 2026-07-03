/**
 * Machine-readable error taxonomy shared by the server (ApiError.kind /
 * jsonResponse) and the client (ShareApiError.kind), so producers and
 * consumers can't drift on the string values the UI switches on.
 */
export type ErrorKind =
  | "gone" // share/recipient no longer exists (deleted, swept, wrong id)
  | "expired" // past its time limit
  | "exhausted" // no views remain
  | "otp_required" // identity share needs email + code
  | "otp_invalid" // wrong/expired code or non-allowlisted email
  | "already_signed" // this recipient already signed
  | "ticket" // signing ticket invalid/expired
  | "unauthorized"; // sign-in required (dashboard)
