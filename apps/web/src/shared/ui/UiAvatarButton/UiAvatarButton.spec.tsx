import { fireEvent, render, screen } from '@testing-library/react';

// `next/image` brings the App Router runtime which jsdom can't load.
// The nested UiAvatar uses it for the src branch — swap for a plain <img>.
jest.mock('next/image', () => ({
    __esModule: true,
    default: ({ src, alt }: { src: string; alt: string }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} data-testid="avatar-img" />
    ),
}));

import { UiAvatarButton } from './UiAvatarButton';

describe('UiAvatarButton', () => {
    it('renders the inner avatar with the provided src', () => {
        render(
            <UiAvatarButton
                src="https://example.com/a.webp"
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={() => {}}
            />
        );

        const img = screen.getByTestId('avatar-img') as HTMLImageElement;
        expect(img.src).toBe('https://example.com/a.webp');
    });

    it('renders the fallback when no src is provided', () => {
        render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={() => {}}
            />
        );

        expect(screen.queryByTestId('avatar-img')).not.toBeInTheDocument();
        expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('exposes the button through its aria-label (the only accessible name)', () => {
        render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={() => {}}
            />
        );

        // Exactly one interactive element with that name — the button itself.
        // The inner UiAvatar's role="img" must be hidden from AT.
        const button = screen.getByRole('button', {
            name: 'Edit profile photo',
        });
        expect(button.tagName).toBe('BUTTON');
        // Inner avatar role is nested under aria-hidden, so AT must see zero
        // "img" roles for this subtree.
        expect(screen.queryAllByRole('img')).toHaveLength(0);
    });

    it('defaults to type="button" to prevent accidental form submission', () => {
        render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={() => {}}
            />
        );

        const button = screen.getByRole('button', {
            name: 'Edit profile photo',
        });
        expect(button).toHaveAttribute('type', 'button');
    });

    it('renders the overlay slot with the hover-hidden class set', () => {
        render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                overlay={<span data-testid="camera-icon">cam</span>}
                onClick={() => {}}
            />
        );

        const overlayHost = screen
            .getByTestId('camera-icon')
            .closest('[data-slot="avatar-button-overlay"]');

        expect(overlayHost).not.toBeNull();
        // Hidden until hover / keyboard focus — verified by class presence
        // rather than computed style (jsdom doesn't evaluate :hover).
        expect(overlayHost?.className).toContain('opacity-0');
        expect(overlayHost?.className).toContain('group-hover:opacity-100');
        expect(overlayHost?.className).toContain(
            'group-focus-visible:opacity-100'
        );
    });

    it('does not render the overlay wrapper when overlay prop is absent', () => {
        const { container } = render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={() => {}}
            />
        );

        expect(
            container.querySelector('[data-slot="avatar-button-overlay"]')
        ).toBeNull();
    });

    it('invokes onClick when clicked', () => {
        const onClick = jest.fn();
        render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={onClick}
            />
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Edit profile photo' })
        );
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('blocks onClick when disabled', () => {
        const onClick = jest.fn();
        render(
            <UiAvatarButton
                fallback="JD"
                aria-label="Edit profile photo"
                onClick={onClick}
                disabled
            />
        );

        const button = screen.getByRole('button', {
            name: 'Edit profile photo',
        });
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });
});
