import { describe, expect, it } from 'vitest';
import { channelRef, gameInVideoTitle, parseVideoChannels, videoEra, videoKind, videoTitleIndex, youtubeVideoId } from './videos.js';

describe('videos', () => {
  it("reads a YouTube video's id from any of its addresses", () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'youtu.be/dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) {
      expect(youtubeVideoId(url)).toBe('dQw4w9WgXcQ');
    }
    expect(youtubeVideoId('https://vimeo.com/123')).toBeNull();
    expect(youtubeVideoId('not a link')).toBeNull();
  });

  it("finds the game a channel's video is about, by the longest title in it, only when the title says what the video is", () => {
    const index = videoTitleIndex(['Halo', 'Halo Infinite', 'Super Metroid', 'The Legend of Zelda: Breath of the Wild', 'Tetris', 'Ys']);
    expect(gameInVideoTitle('Halo Infinite Review - IGN', index)).toBe('Halo Infinite');
    expect(gameInVideoTitle('The Legend of Zelda: Breath of the Wild Video Review', index)).toBe('The Legend of Zelda: Breath of the Wild');
    expect(gameInVideoTitle('The Story of Super Metroid | Gaming Historian', index)).toBe('Super Metroid');
    // A video naming a game in passing isn't about it; one titled just the game is.
    expect(gameInVideoTitle('Top 10 games like Tetris', index)).toBeNull();
    expect(gameInVideoTitle('Tetris', index)).toBe('Tetris');
    // A title too short to find on its own.
    expect(gameInVideoTitle('Ys Review', index)).toBeNull();
    expect(videoKind('Super Metroid - Official Trailer')).toBe('trailer');
  });

  it("puts a video in the game's own time (before it came out or within the window) or looking back", () => {
    expect(videoEra('2017-03-02T14:00:00Z', '2017-03-03', 18)).toBe('time');
    expect(videoEra('2016-06-14', '2017-03-03', 18)).toBe('time');
    expect(videoEra('2023-05-01', '2017-03-03', 18)).toBe('later');
    expect(videoEra(null, '2017-03-03', 18)).toBeNull();
  });

  it('reads the channel lines and what YouTube is asked for each', () => {
    expect(parseVideoChannels(['IGN | @IGN | on', 'Old ads | @oldads | off | archive', 'no handle'])).toEqual([
      { name: 'IGN', handle: '@IGN', on: true, archive: false },
      { name: 'Old ads', handle: '@oldads', on: false, archive: true },
    ]);
    expect(channelRef('@IGN')).toEqual({ handle: 'IGN' });
    expect(channelRef('https://www.youtube.com/@GamingHistorian/videos')).toEqual({ handle: 'GamingHistorian' });
    expect(channelRef('https://www.youtube.com/channel/UCKy1dAqELo0zrOtPkf0eTMw')).toEqual({ id: 'UCKy1dAqELo0zrOtPkf0eTMw' });
    expect(channelRef('nonsense')).toBeNull();
  });
});
