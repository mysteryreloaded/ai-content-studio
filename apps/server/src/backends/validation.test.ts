import { describe, expect, test } from "bun:test";
import { validateBackendInput } from "./validation.js";

describe("validateBackendInput", () => {
  test("accepts a minimal valid input", () => {
    expect(
      validateBackendInput({
        name: "GPU 1",
        baseUrl: "http://10.0.0.5:8188",
        auth: "none",
      }),
    ).toEqual([]);
  });

  test("accepts an https base URL with a path", () => {
    const errors = validateBackendInput({
      name: "GPU 1",
      baseUrl: "https://comfy.example.com/instance-1",
      auth: "none",
    });
    expect(errors).toEqual([]);
  });

  test("rejects an empty name", () => {
    const errors = validateBackendInput({
      name: "",
      baseUrl: "http://x",
      auth: "none",
    });
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  test("rejects a name over 60 characters", () => {
    const errors = validateBackendInput({
      name: "x".repeat(61),
      baseUrl: "http://x",
      auth: "none",
    });
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  test("rejects a non-http(s) scheme", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "ftp://x.com",
      auth: "none",
    });
    expect(errors.some((e) => e.field === "baseUrl")).toBe(true);
  });

  test("rejects a query string", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com/?a=1",
      auth: "none",
    });
    expect(errors.some((e) => e.field === "baseUrl")).toBe(true);
  });

  test("rejects a fragment", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com/#frag",
      auth: "none",
    });
    expect(errors.some((e) => e.field === "baseUrl")).toBe(true);
  });

  test("rejects embedded credentials in the URL", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://user:pass@x.com",
      auth: "none",
    });
    expect(errors.some((e) => e.field === "baseUrl")).toBe(true);
  });

  test("rejects an invalid header name", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com",
      auth: "header",
      headerName: "bad header",
      headerValue: "v",
    });
    expect(errors.some((e) => e.field === "headerName")).toBe(true);
  });

  test("accepts a valid header name", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com",
      auth: "header",
      headerName: "X-Api-Key",
      headerValue: "v",
    });
    expect(errors).toEqual([]);
  });

  test("rejects header auth with a blank header name", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com",
      auth: "header",
      headerValue: "v",
    });
    expect(errors.some((e) => e.field === "headerName")).toBe(true);
  });

  test("rejects header auth on create with no credential value supplied", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com",
      auth: "header",
      headerName: "X-Api-Key",
    });
    expect(errors.some((e) => e.field === "headerValue")).toBe(true);
  });

  test("rejects basic auth on create with no user/pass supplied", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com",
      auth: "basic",
    });
    expect(errors.some((e) => e.field === "basicUser")).toBe(true);
  });

  test("accepts basic auth with a user and pass", () => {
    const errors = validateBackendInput({
      name: "n",
      baseUrl: "http://x.com",
      auth: "basic",
      basicUser: "u",
      basicPass: "p",
    });
    expect(errors).toEqual([]);
  });

  test("blank header auth credentials are accepted when an existing credential is on file", () => {
    const errors = validateBackendInput(
      {
        name: "n",
        baseUrl: "http://x.com",
        auth: "header",
        headerName: "X-Api-Key",
      },
      { hasExistingCredentials: true },
    );
    expect(errors).toEqual([]);
  });

  test("blank basic auth credentials are accepted when an existing credential is on file", () => {
    const errors = validateBackendInput(
      { name: "n", baseUrl: "http://x.com", auth: "basic" },
      { hasExistingCredentials: true },
    );
    expect(errors).toEqual([]);
  });
});
