import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../model/defaults';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { SettingsSections } from './Sidebar';

const RESET = 'Alle Einstellungen zurücksetzen';
const tilt = (): number => useConfigStore.getState().config.panels.tiltFromVertical;

describe('SettingsSections', () => {
  beforeEach(() => {
    resetStores();
    useConfigStore.getState().patch('horizon', { terrainEnabled: false });
    act(() => useConfigStore.getState().patch('panels', { tiltFromVertical: 30 }));
  });

  it('nests the sections under the "Einstellungen" heading', () => {
    useUiStore.setState({ openSections: { location: true } });
    render(<SettingsSections />);
    expect(screen.getByRole('heading', { level: 2, name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Standort/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Wetterdaten/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Ort finden' })).toBeInTheDocument();
  });

  describe('reset confirmation', () => {
    it('focuses the safe choice and describes the group with the question', () => {
      render(<SettingsSections />);
      fireEvent.click(screen.getByRole('button', { name: RESET }));
      const group = screen.getByRole('group', { name: RESET });
      expect(group).toHaveAccessibleDescription(
        'Wirklich alle Einstellungen auf die Standardwerte zurücksetzen?',
      );
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    });

    it('cancels on Escape and returns the focus to the reset button', () => {
      render(<SettingsSections />);
      fireEvent.click(screen.getByRole('button', { name: RESET }));
      fireEvent.keyDown(screen.getByRole('button', { name: 'Abbrechen' }), { key: 'Escape' });
      expect(screen.queryByRole('group', { name: RESET })).not.toBeInTheDocument();
      expect(tilt()).toBe(30);
      expect(screen.getByRole('button', { name: RESET })).toHaveFocus();
    });

    it('cancels with the button and returns the focus to the reset button', () => {
      render(<SettingsSections />);
      fireEvent.click(screen.getByRole('button', { name: RESET }));
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
      expect(screen.queryByRole('group', { name: RESET })).not.toBeInTheDocument();
      expect(tilt()).toBe(30);
      expect(screen.getByRole('button', { name: RESET })).toHaveFocus();
    });

    it('resets after confirmation and returns the focus to the reset button', () => {
      render(<SettingsSections />);
      fireEvent.click(screen.getByRole('button', { name: RESET }));
      fireEvent.click(screen.getByRole('button', { name: 'Ja, zurücksetzen' }));
      expect(useConfigStore.getState().config).toEqual(DEFAULT_CONFIG);
      expect(screen.getByRole('button', { name: RESET })).toHaveFocus();
    });

    it('does not take the focus on first render', () => {
      render(<SettingsSections />);
      expect(screen.getByRole('button', { name: RESET })).not.toHaveFocus();
    });
  });
});
