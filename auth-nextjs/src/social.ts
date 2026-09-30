import { NextResponse, type NextRequest } from "next/server.js";
import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
  createHandoffVerifier,
  createHandoffChallenge,
  buildSocialStartUrl,
  parseHandoffCallback,
  safeRedirectPath,
  REDEEM_LOGIN_HANDOFF_MUTATION,
  type SocialProvider,
  type LoginHandoffResponse,
} from "@pylo/auth";
import { getAppId, getCookieOptions, setAuthCookiesOnResponse } from "./cookies.js";
import { getEndpoint } from "./server.js";

const CALLBACK_PATH = "/api/auth/callback";
const PROVIDERS: readonly string[] = ["google", "microsoft"] satisfies readonly SocialProvider[];

const verifierCookieName = (): string => `pylo_handoff_verifier_${getAppId()}`;

const firstHeader = (req: NextRequest, name: string): string | undefined =>
  req.headers.get(name)?.split(",")[0]?.trim() || undefined;

// req.url carries the host the server is bound to (e.g. 0.0.0.0), not the one behind a proxy.
// A forged host is harmless: the broker only returns to a registered return URL.
const appOrigin = (req: NextRequest): string => {
  const proto = firstHeader(req, "x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const host = firstHeader(req, "x-forwarded-host") ?? firstHeader(req, "host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
};

export function createSocialStartRoute(o: { returnUrl?: string } = {}) {
  return async (
    req: NextRequest,
    ctx: { params: Promise<{ provider: string }> | { provider: string } },
  ): Promise<NextResponse> => {
    const { provider } = await ctx.params;
    if (!PROVIDERS.includes(provider)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const returnUrl = o.returnUrl ?? `${appOrigin(req)}${CALLBACK_PATH}`;
    const verifier = await createHandoffVerifier();
    const redirect = req.nextUrl.searchParams.get("redirect");
    const invite = req.nextUrl.searchParams.get("invite");
    const url = buildSocialStartUrl({
      endpoint: getEndpoint(),
      provider: provider as SocialProvider,
      appId: getAppId(),
      returnUrl,
      challenge: await createHandoffChallenge(verifier),
      ...(redirect ? { redirect } : {}),
      ...(invite ? { invite } : {}),
    });

    const res = NextResponse.redirect(url, 302);
    res.cookies.set(verifierCookieName(), verifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: getCookieOptions().secure,
      path: new URL(returnUrl).pathname,
      maxAge: 600,
    });
    return res;
  };
}

export function createSocialCallbackRoute(o: { loginPath?: string } = {}) {
  const loginPath = o.loginPath ?? "/auth/login";

  return async (req: NextRequest): Promise<NextResponse> => {
    const name = verifierCookieName();
    const verifier = req.cookies.get(name)?.value;
    const done = (res: NextResponse) => {
      res.cookies.delete({ name, path: req.nextUrl.pathname });
      return res;
    };
    const fail = (message: string) => {
      const url = new URL(loginPath, appOrigin(req));
      url.searchParams.set("error", message);
      return done(NextResponse.redirect(url, 302));
    };

    const result = parseHandoffCallback(req.url);
    if (result && "error" in result) return fail(result.error);
    if (!result || !verifier) return fail("Sign-in failed");

    try {
      const response = await graphqlRequest<LoginHandoffResponse>(
        getEndpoint(),
        REDEEM_LOGIN_HANDOFF_MUTATION,
        { input: { code: result.code, handoff_verifier: verifier } },
      );
      if (hasErrors(response)) return fail(extractErrorMessage(response.errors) ?? "Sign-in failed");
      if (!response.data) return fail("Sign-in failed");

      const { auth_token, refresh_token, redirect } = response.data.redeemLoginHandoff.data;
      const res = NextResponse.redirect(new URL(safeRedirectPath(redirect) ?? "/", appOrigin(req)), 302);
      setAuthCookiesOnResponse(res, auth_token, refresh_token);
      return done(res);
    } catch {
      return fail("Sign-in failed");
    }
  };
}
