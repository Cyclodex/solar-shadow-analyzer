import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { Section } from './Section';

describe('Section', () => {
  beforeEach(resetStores);

  it('toggles via a button with aria-expanded and stores the state', () => {
    render(
      <Section id="building" title="Gebäude" summary="202° SSW">
        <p>Inhalt</p>
      </Section>,
    );
    const button = screen.getByRole('button', { name: /Gebäude/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Inhalt')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Inhalt')).toBeVisible();
    expect(useUiStore.getState().openSections.building).toBe(true);
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).toContainElement(
      screen.getByText('Inhalt'),
    );
  });
});
