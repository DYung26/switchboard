import { describe, expect, it } from "vitest";
import { getRegistrableDomain } from "../registrable-domain";

describe("getRegistrableDomain", () => {
  it("returns the domain unchanged when it has no subdomain", () => {
    expect(getRegistrableDomain("example.com")).toBe("example.com");
  });

  it("strips a simple subdomain down to the registrable domain", () => {
    expect(getRegistrableDomain("app.example.com")).toBe("example.com");
  });

  it("strips a deeply nested subdomain down to the registrable domain", () => {
    expect(getRegistrableDomain("accounts.auth.example.com")).toBe(
      "example.com",
    );
  });

  it("keeps the public suffix intact for known multi-part TLDs", () => {
    expect(getRegistrableDomain("app.example.co.uk")).toBe("example.co.uk");
  });

  it("does not over-strip a bare multi-part TLD domain", () => {
    expect(getRegistrableDomain("example.co.uk")).toBe("example.co.uk");
  });

  it("returns localhost unchanged", () => {
    expect(getRegistrableDomain("localhost")).toBe("localhost");
  });

  it("returns an IPv4 address unchanged", () => {
    expect(getRegistrableDomain("192.168.0.1")).toBe("192.168.0.1");
  });
});
