import { handleGame } from './app/server/game-api';

type Bindings = { DB: D1Database; ASSETS: Fetcher };

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/game') return handleGame(request, env.DB);
    if (url.pathname === '/') {
      url.pathname = '/game.html';
      return Response.redirect(url.href, 307);
    }
    return env.ASSETS.fetch(request);
  },
};
