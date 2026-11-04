function path(app) {
  return $os.getenv('CHECKY_CONFIG_FILE') || app.dataDir() + '/checky-config.json'
}
function read(app) {
  let raw
  try { raw = toString($os.readFile(path(app))) } catch (error) {
    if (/no such file|cannot find the file/i.test(String(error))) return {}
    throw new InternalServerError('Cannot read checky-config.json.')
  }
  let config
  try { config = JSON.parse(raw) } catch (_) { throw new InternalServerError('checky-config.json must contain valid JSON.') }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config.publicOrigin !== undefined && typeof config.publicOrigin !== 'string') ||
      (config.pushSubject !== undefined && typeof config.pushSubject !== 'string') ||
      (config.remindersEnabled !== undefined && typeof config.remindersEnabled !== 'boolean')) {
    throw new InternalServerError('Invalid checky-config.json settings.')
  }
  return config
}
function ensure(app) {
  const file = path(app)
  try { $os.stat(file); return } catch (error) {
    if (!/no such file|cannot find the file/i.test(String(error))) throw error
  }
  $os.writeFile(file, JSON.stringify({ publicOrigin: '', pushSubject: '', remindersEnabled: true }, null, 2) + '\n', 0o600)
}
module.exports = { read, ensure }
