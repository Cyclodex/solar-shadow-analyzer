import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFormat } from '../../i18n';
import { useUiStore } from '../../state/uiStore';
import { resetStores } from '../../test/utils';
import { relativeDirection, useViewText, viewMessages } from './messages';

beforeEach(resetStores);

describe('view texts', () => {
  it('have the same entries in German and English', () => {
    const { de, en } = viewMessages;
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(typeof en[key]).toBe(typeof de[key]);
    }
  });

  it('follow the UI language', () => {
    const { result } = renderHook(() => useViewText());
    expect(result.current.behindFacade).toBe('hinter der Fassade');
    act(() => useUiStore.getState().setLang('en'));
    expect(result.current.behindFacade).toBe('behind the facade');
    // Parameterised texts put every value in.
    expect(result.current.overlap('3 cm')).toMatch(/overlap by 3 cm/);
    expect(result.current.belowGround('7 cm', 'GF')).toMatch(/\(GF\) .*7 cm below ground/);
    expect(result.current.at('12:30', 'MESZ')).toBe('12:30 MESZ');
  });
});

describe('relativeDirection', () => {
  const f = getFormat('de');

  it('says left or right as seen from outside, from the sign of the angle', () => {
    expect(relativeDirection(22, viewMessages.de, f)).toBe('22° links der Fassadennormalen');
    expect(relativeDirection(-22.4, viewMessages.de, f)).toBe('22° rechts der Fassadennormalen');
    expect(relativeDirection(-135, viewMessages.en, getFormat('en'))).toBe('135° right of the facade normal');
  });

  it('calls anything under half a degree straight ahead', () => {
    expect(relativeDirection(0.49, viewMessages.de, f)).toBe('genau vor der Fassade');
    expect(relativeDirection(-0.49, viewMessages.en, getFormat('en'))).toBe(
      'straight in front of the facade',
    );
    expect(relativeDirection(0.5, viewMessages.de, f)).toBe('1° links der Fassadennormalen');
  });
});
