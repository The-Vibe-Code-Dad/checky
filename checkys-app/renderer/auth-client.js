(function (root) {
  async function authenticate(request, email, password, requestCode) {
    let result;
    try {
      result = await request('/api/collections/users/auth-with-password', { identity: email, password });
    } catch (error) {
      const mfaId = error.payload?.mfaId;
      if (!mfaId) throw error;
      const otp = await request('/api/collections/users/request-otp', { email });
      if (!otp?.otpId) throw new Error('Could not send a verification code. Contact your administrator.');
      const code = await requestCode(email);
      if (!code) throw new Error('Sign-in cancelled.');
      result = await request('/api/collections/users/auth-with-otp', { otpId: otp.otpId, password: code, mfaId });
    }
    if (!result?.token || !result?.record?.id) throw new Error('Sign-in did not complete.');
    return result;
  }
  const api = { authenticate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.checkyAuth = api;
})(typeof window === 'object' ? window : globalThis);
