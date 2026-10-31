// Test-only mail sink. Mounted explicitly by the test runner; never copied into images.
if ($os.getenv('CHECKY_TEST_MAIL') === 'true') {
  onMailerSend(() => {})
  onMailerRecordOTPSend((e) => {
    e.app.store().set('checky-test-otp:' + e.record.getString('email'), {otpId:e.meta.otpId, password:e.meta.password})
  }, 'users')
  routerAdd('POST', '/api/checky-test/otp', (e) => {
    return e.json(200, e.app.store().get('checky-test-otp:' + e.requestInfo().body.email) || {})
  }, $apis.requireSuperuserAuth())
}
