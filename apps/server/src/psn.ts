import type { PsnApi, PsnTokens } from './achievements.js';

/**
 * PlayStation's sign-in and trophy lists through psn-api (MIT, github.com/achievements-app/psn-api), which speaks the
 * PlayStation App's own API: Sony has no public one. Loaded only when PlayStation trophies are read.
 */
const tokens = (raw: { accessToken?: string; refreshToken?: string; refreshTokenExpiresIn?: number }): PsnTokens => ({
  accessToken: raw.accessToken ?? '',
  refreshToken: raw.refreshToken ?? '',
  refreshTokenExpiresIn: raw.refreshTokenExpiresIn ?? 0,
});

export const psnApi: PsnApi = {
  async signIn(npsso) {
    const psn = await import('psn-api');
    const code = await psn.exchangeNpssoForAccessCode(npsso);
    return tokens(await psn.exchangeAccessCodeForAuthTokens(code));
  },
  async refresh(refreshToken) {
    const psn = await import('psn-api');
    return tokens(await psn.exchangeRefreshTokenForAuthTokens(refreshToken));
  },
  async titles(accessToken, offset) {
    const psn = await import('psn-api');
    const page = (await psn.getUserTitles({ accessToken }, 'me', { limit: 800, offset })) as Awaited<ReturnType<typeof psn.getUserTitles>> & { error?: { message?: string } };
    // An error comes back as PlayStation's answer, not thrown.
    if (!Array.isArray(page.trophyTitles)) throw new Error(`PlayStation answered: ${page.error?.message ?? 'no trophy list'}.`);
    return { trophyTitles: page.trophyTitles, totalItemCount: page.totalItemCount, nextOffset: page.nextOffset };
  },
};
