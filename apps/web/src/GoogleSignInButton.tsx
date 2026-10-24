import { useTheme } from "./useTheme.js";

interface GoogleSignInButtonProps {
  href: string;
}

const LIGHT_STYLE = {
  background: "#ffffff",
  color: "#1f1f1f",
  border: "1px solid #747775",
};

const DARK_STYLE = {
  background: "#131314",
  color: "#e3e3e3",
  border: "1px solid #8e918f",
};

const BUTTON_BASE_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px 12px",
  borderRadius: "4px",
  fontFamily: "Roboto, Arial, sans-serif",
  fontSize: "14px",
  fontWeight: 500,
  textDecoration: "none",
  lineHeight: "20px",
};

/**
 * Google's official "Sign in with Google" asset (bundled, not loaded
 * from Google), light or dark to match the theme (issue #65/#31).
 */
export function GoogleSignInButton({ href }: GoogleSignInButtonProps) {
  const { resolvedTheme } = useTheme();
  const themeStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  return (
    <a href={href} style={{ ...BUTTON_BASE_STYLE, ...themeStyle }}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
        />
      </svg>
      Sign in with Google
    </a>
  );
}
