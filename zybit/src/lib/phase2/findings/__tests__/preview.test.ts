import { describe, expect, it } from 'vitest';
import { isPrivateIp, isSafePreviewHost } from '../preview';

describe('isPrivateIp', () => {
  it('flags IPv4 loopback', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.255.255.255')).toBe(true);
  });

  it('flags RFC1918 ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
  });

  it('does NOT flag near-RFC1918 ranges', () => {
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('192.167.1.1')).toBe(false);
    expect(isPrivateIp('11.0.0.1')).toBe(false);
  });

  it('flags link-local + cloud metadata (169.254.169.254)', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('169.254.0.1')).toBe(true);
  });

  it('flags CGNAT (100.64.0.0/10)', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('100.127.255.255')).toBe(true);
    expect(isPrivateIp('100.63.255.255')).toBe(false);
    expect(isPrivateIp('100.128.0.1')).toBe(false);
  });

  it('flags 0.0.0.0/8', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isPrivateIp('0.1.2.3')).toBe(true);
  });

  it('flags IPv6 loopback + link-local + ULA', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd12:3456:789a::1')).toBe(true);
  });

  it('flags IPv4-mapped IPv6 (::ffff:127.0.0.1)', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('does NOT flag public addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('isSafePreviewHost', () => {
  it('rejects literal localhost', async () => {
    const r = await isSafePreviewHost('localhost');
    expect(r.ok).toBe(false);
  });

  it('rejects subdomains of localhost', async () => {
    const r = await isSafePreviewHost('foo.localhost');
    expect(r.ok).toBe(false);
  });

  it('rejects private IP literals as hostnames', async () => {
    expect((await isSafePreviewHost('127.0.0.1')).ok).toBe(false);
    expect((await isSafePreviewHost('169.254.169.254')).ok).toBe(false);
    expect((await isSafePreviewHost('10.0.0.1')).ok).toBe(false);
  });
});
