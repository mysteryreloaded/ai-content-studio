import { describe, expect, test } from "bun:test";

import type { UseFormSetError } from "react-hook-form";

import { ApiError } from "./api.js";
import { mapApiError, mapServerIssues, zodResolver } from "./form.js";

type Fields = {
  email: string;
  profile?: { name: string };
};

function fakeSetError() {
  const calls: Array<{ field: string; message: string }> = [];
  const setError = (field: string, options: { message?: string }) => {
    calls.push({ field, message: options.message ?? "" });
  };
  return {
    calls,
    setError: setError as unknown as UseFormSetError<Fields>,
  };
}

describe("mapServerIssues", () => {
  test("sets each issue on its field via the dot-joined path, and an empty path on the form root", () => {
    const { calls, setError } = fakeSetError();
    mapServerIssues<Fields>(setError, [
      { path: ["email"], message: "bad email" },
      { path: [], message: "form is wrong" },
      { path: ["profile", "name"], message: "nested is bad" },
    ]);
    expect(calls).toEqual([
      { field: "email", message: "bad email" },
      { field: "root", message: "form is wrong" },
      { field: "profile.name", message: "nested is bad" },
    ]);
  });

  test("does nothing when there are no issues", () => {
    const { calls, setError } = fakeSetError();
    mapServerIssues<Fields>(setError, []);
    expect(calls).toEqual([]);
  });
});

describe("mapApiError", () => {
  test("maps the issues carried in a 400 body", () => {
    const { calls, setError } = fakeSetError();
    const error = new ApiError(400, {
      error: "invalid input",
      issues: [{ path: ["email"], message: "bad email" }],
    });
    mapApiError<Fields>(setError, error);
    expect(calls).toEqual([{ field: "email", message: "bad email" }]);
  });

  test("ignores a body without issues (e.g. a 500)", () => {
    const { calls, setError } = fakeSetError();
    mapApiError<Fields>(
      setError,
      new ApiError(500, { error: "internal error" }),
    );
    expect(calls).toEqual([]);
  });

  test("ignores a non-JSON body", () => {
    const { calls, setError } = fakeSetError();
    mapApiError<Fields>(setError, new ApiError(500, null));
    expect(calls).toEqual([]);
  });
});

describe("zodResolver", () => {
  test("is re-exported from @hookform/resolvers", () => {
    expect(typeof zodResolver).toBe("function");
  });
});
