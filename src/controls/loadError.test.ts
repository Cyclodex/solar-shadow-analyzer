import { describe, expect, it } from 'vitest';
import { classifyLoadError } from './loadError';

describe('classifyLoadError', () => {
  it('recognises failed fetches of the common browsers', () => {
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'The network connection was lost.',
      'fetch failed',
    ]) {
      expect(classifyLoadError(message)).toEqual({ kind: 'network' });
    }
  });

  it('reads the HTTP status of Open-Meteo and DEM tile errors', () => {
    expect(classifyLoadError('Open-Meteo: HTTP 500 – test')).toEqual({ kind: 'http', status: 500 });
    expect(classifyLoadError('Open-Meteo: HTTP 429')).toEqual({ kind: 'http', status: 429 });
    expect(
      classifyLoadError(
        'DEM tile https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2132/1438.png: HTTP 404',
      ),
    ).toEqual({ kind: 'http', status: 404 });
  });

  it('treats unreadable, malformed or incomplete responses as data errors', () => {
    expect(classifyLoadError('Open-Meteo: HTTP 200')).toEqual({ kind: 'data' });
    expect(classifyLoadError('Open-Meteo: malformed response (hourly.time)')).toEqual({ kind: 'data' });
    expect(classifyLoadError('Open-Meteo: 120 of 8760 hours missing (year 2025 incomplete?)')).toEqual({
      kind: 'data',
    });
    expect(classifyLoadError('Unexpected Terrarium tile format: 512×512, 3 ch, 8 bit')).toEqual({
      kind: 'data',
    });
  });

  it('recognises a site without elevation data', () => {
    expect(classifyLoadError('No elevation data at the site')).toEqual({ kind: 'no-elevation' });
  });

  it('returns null for unknown messages', () => {
    expect(classifyLoadError('wrong PNG signature')).toBeNull();
  });
});
