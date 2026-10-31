// Required inside each callback: PocketBase runs callbacks in separate JS VMs.
const COOKIE = "checky_base_session"
const SESSIONS = "checky_base_sessions"
const TTL = 12 * 60 * 60 * 1000
function hasSuperuser(app) {
  // PocketBase creates this reserved temporary account for its first-install link.
  return app.countRecords('_superusers', $dbx.exp('email != {:email}', {email:'__pbinstaller@example.com'})) > 0
}

function stamp(user) {
  const c = user.collection()
  return $security.sha256(JSON.stringify([user.getString("tokenKey"), c.authRule, c.passwordAuth, c.mfa, c.otp, c.oauth2]))
}
function cookieKey(e) {
  try { return e.request.cookie(COOKIE).value || "" } catch (_) { return "" }
}
function publicOrigin(e) {
  const configured = $os.getenv("CHECKY_PUBLIC_ORIGIN").trim()
  if (!configured) return ""
  // A deployment setting, never an Origin/forwarded header supplied by the caller.
  const invalid = () => new InternalServerError("CHECKY_PUBLIC_ORIGIN must be an http(s) origin without a path, credentials, query, or fragment.")
  let url
  try { url = e.request.url.parse(configured) } catch (_) { throw invalid() }
  if (!["http", "https"].includes(url.scheme) || !url.hostname() || url.user ||
      (url.path && url.path !== "/") || url.rawQuery || url.forceQuery || configured.includes("#")) throw invalid()
  const port = url.port()
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw invalid()
  const host = url.host.toLowerCase().replace(url.scheme === "https" ? /:443$/ : /:80$/, "")
  return url.scheme + "://" + host
}
function requestOrigin(e) {
  // Caddy sanitizes forwarding headers; a fixed public origin also works behind
  // HTTPS tunnels whose private HTTP hop or Host differs from the browser URL.
  const scheme = e.isTLS() || e.request.header.get("X-Forwarded-Proto") === "https" ? "https" : "http"
  return publicOrigin(e) || scheme + "://" + e.request.host
}
function cookie(e, key) {
  const secure = requestOrigin(e).startsWith("https://")
  e.setCookie(new Cookie({ name: COOKIE, value: key, path: "/", httpOnly: true,
    secure, sameSite: 2, maxAge: key ? TTL / 1000 : -1 }))
}
function sessionRecord(app, key) {
  if (!key) return null
  try { return app.findFirstRecordByData(SESSIONS, "key", key) } catch (_) { return null }
}
function allowed(e, user) {
  const info = e.requestInfo()
  info.auth = user
  return e.app.canAccessRecord(user, info, user.collection().authRule)
}
function requireSameOrigin(e) {
  const origin = e.request.header.get("Origin")
  if (!origin) return // Native clients do not send Origin.
  if (origin !== requestOrigin(e)) throw new ForbiddenError("Cross-origin session request rejected.")
}
function loadCookie(e) {
  if (e.request.header.get("Authorization")) return
  const key = cookieKey(e)
  if (!key) return
  const record = sessionRecord(e.app, key)
  let user = null
  if (record && Date.parse(record.getString("expiresAt")) > Date.now()) {
    try { user = e.app.findRecordById("users", record.getString("user")) } catch (_) {}
  }
  if (!user || !record.getString("credentialStamp") || record.getString("credentialStamp") !== stamp(user) || !allowed(e, user)) {
    if (record) e.app.delete(record)
    cookie(e, "")
    return
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(e.request.method)) requireSameOrigin(e)
  e.auth = user
  if (Date.parse(record.getString("expiresAt")) - Date.now() < 30 * 60 * 1000) {
    record.set("expiresAt", new Date(Date.now() + TTL).toISOString())
    record.set("lastSeenAt", new Date().toISOString())
    e.app.save(record)
    cookie(e, key)
  }
}
function isAdmin(app, user) {
  if (!user) return false
  try { return app.findFirstRecordByData("checky_base_admins", "key", "primary").getString("user") === user.id } catch (_) { return false }
}
function snapshot(e) {
  let primary = null
  try { primary = e.app.findFirstRecordByData("checky_base_admins", "key", "primary") } catch (_) {}
  const user = e.auth && e.auth.collection().name === "users" ? e.auth : null
  return { setupRequired: !primary && !e.app.countRecords('users') && !hasSuperuser(e.app), authenticated: !!user,
    user: user ? { id: user.id, email: user.getString("email"), isAdmin: isAdmin(e.app, user) } : null }
}
function createSession(e, user) {
  const previous = sessionRecord(e.app, cookieKey(e))
  if (previous) e.app.delete(previous)
  const record = new Record(e.app.findCollectionByNameOrId(SESSIONS))
  record.set("key", $security.randomString(50))
  record.set("user", user.id)
  record.set("credentialStamp", stamp(user))
  record.set("expiresAt", new Date(Date.now() + TTL).toISOString())
  record.set("lastSeenAt", new Date().toISOString())
  record.set("createdByIp", e.realIP())
  record.set("createdByUserAgent", String(e.request.header.get("User-Agent") || "").slice(0, 500))
  e.app.save(record)
  cookie(e, record.getString("key"))
  e.auth = user
}
function login(e) {
  requireSameOrigin(e)
  const body = e.requestInfo().body || {}
  if (typeof body.token !== "string" || !body.token) throw new BadRequestError("Refresh Checky's List and sign in using the current sign-in form.")
  let user
  try { user = e.app.findAuthRecordByToken(body.token, "auth") } catch (_) { throw new UnauthorizedError("Sign in again.") }
  if (user.collection().name !== "users" || !allowed(e, user)) throw new ForbiddenError("This account cannot sign in.")
  createSession(e, user)
  return { ok: true, ...snapshot(e) }
}
function logout(e) {
  requireSameOrigin(e)
  const record = sessionRecord(e.app, cookieKey(e))
  if (record) e.app.delete(record)
  cookie(e, "")
  return { ok: true }
}
function bootstrap(e) {
  requireSameOrigin(e)
  const body = e.requestInfo().body || {}
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email || typeof body.password !== "string" || body.password !== body.passwordConfirm) throw new BadRequestError("Email and matching passwords are required.")
  e.app.runInTransaction((tx) => {
    // Recheck under the write transaction; never reopen setup on an existing user database.
    if (tx.countRecords("checky_base_admins") || tx.countRecords("users") || hasSuperuser(tx)) throw new ForbiddenError("The first admin has already been created.")
    const superuser = new Record(tx.findCollectionByNameOrId("_superusers"))
    superuser.set("email", email)
    superuser.setPassword(body.password)
    tx.save(superuser)
    const user = new Record(tx.findCollectionByNameOrId("users"))
    user.set("email", email)
    user.setPassword(body.password)
    tx.save(user)
    const admin = new Record(tx.findCollectionByNameOrId("checky_base_admins"))
    admin.set("key", "primary")
    admin.set("user", user.id)
    tx.save(admin)
  })
  // The frontend then signs in through the standard password/MFA endpoints.
  return { ok: true }
}
module.exports = { loadCookie, snapshot, login, logout, bootstrap }
