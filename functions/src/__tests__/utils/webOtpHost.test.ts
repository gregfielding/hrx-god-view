import { buildOtpSmsBody, resolveWebOtpHost } from '../../utils/webOtpHost';

describe('resolveWebOtpHost', () => {
  it('echoes hosts we serve (case and trailing dot tolerant)', () => {
    expect(resolveWebOtpHost('app.c1staffing.com', 'hrxone.com')).toBe('app.c1staffing.com');
    expect(resolveWebOtpHost('HRXONE.COM', 'x')).toBe('hrxone.com');
    expect(resolveWebOtpHost('app.hrxone.com.', 'x')).toBe('app.hrxone.com');
  });

  it('falls back for missing, foreign or malformed hosts', () => {
    expect(resolveWebOtpHost(undefined, 'hrxone.com')).toBe('hrxone.com');
    expect(resolveWebOtpHost('', 'hrxone.com')).toBe('hrxone.com');
    expect(resolveWebOtpHost('evil.example', 'hrxone.com')).toBe('hrxone.com');
    expect(resolveWebOtpHost('hrxone.com.evil.example', 'hrxone.com')).toBe('hrxone.com');
    expect(resolveWebOtpHost(42, 'hrxone.com')).toBe('hrxone.com');
  });
});

describe('buildOtpSmsBody', () => {
  it('ends with the exact WebOTP binding line', () => {
    const body = buildOtpSmsBody('123456', 'app.c1staffing.com');
    expect(body).toBe('Your C1 Staffing verification code is 123456. It expires in 10 minutes.\n\n@app.c1staffing.com #123456');
    expect(body.split('\n').pop()).toBe('@app.c1staffing.com #123456');
  });
});
