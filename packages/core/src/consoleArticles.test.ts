import { describe, expect, it } from 'vitest';
import { commonsFilePage, consoleArticle, unitsSoldShort } from './consoleArticles.js';

describe('unitsSoldShort', () => {
  it('keeps the first figure of the text', () => {
    expect(unitsSoldShort("About 87.4 million worldwide (Sony's final figure)")).toBe('87.4 million');
    expect(unitsSoldShort('Over 117 million (as of March 31, 2022)')).toBe('117 million');
    expect(unitsSoldShort('30.75 million by Sega, plus consoles by Majesco and Tectoy')).toBe('30.75 million');
    expect(unitsSoldShort('1 million MVS arcade systems and 410,000 AES home consoles')).toBe('1 million');
    expect(unitsSoldShort('770,000')).toBe('770,000');
  });
  it('keeps a range', () => {
    expect(unitsSoldShort('20,000–30,000 (estimated)')).toBe('20,000–30,000');
    expect(unitsSoldShort('1-2 million')).toBe('1–2 million');
  });
  it('says nothing when there is no figure', () => {
    expect(unitsSoldShort(null)).toBeNull();
    expect(unitsSoldShort('')).toBeNull();
    expect(unitsSoldShort('Never reported')).toBeNull();
  });
});

describe('console articles', () => {
  it('uses the table, else the name', () => {
    expect(consoleArticle('sega-genesis', 'Sega Genesis')).toBe('Sega Genesis');
    expect(consoleArticle('atari-2600', 'x')).toBe('Atari 2600');
    expect(consoleArticle('nothing-known', 'Some Console')).toBe('Some Console');
  });
  it('credits a Commons picture and only Commons', () => {
    expect(commonsFilePage('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/PS3-Fat-Console-Set.jpg/320px-PS3-Fat-Console-Set.jpg')).toBe('https://commons.wikimedia.org/wiki/File:PS3-Fat-Console-Set.jpg');
    expect(commonsFilePage('https://upload.wikimedia.org/wikipedia/commons/a/ab/Vectrex-Console-Set.jpg')).toBe('https://commons.wikimedia.org/wiki/File:Vectrex-Console-Set.jpg');
    expect(commonsFilePage('https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Vectrex-Console-Set.jpg/330px-Vectrex-Console-Set.jpg?utm_source=en.wikipedia.org')).toBe('https://commons.wikimedia.org/wiki/File:Vectrex-Console-Set.jpg');
    expect(commonsFilePage('https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Logo.png/320px-Logo.png')).toBeNull();
  });
});
