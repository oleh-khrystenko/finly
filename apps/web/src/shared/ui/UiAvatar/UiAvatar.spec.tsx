import { render, screen, fireEvent } from '@testing-library/react';

// `next/image` brings the App Router runtime which jsdom can't load.
// Replace it with a plain <img> so we keep onError/onLoad semantics.
jest.mock('next/image', () => ({
    __esModule: true,
    default: ({
        src,
        alt,
        onError,
        onLoad,
        className,
    }: {
        src: string;
        alt: string;
        onError?: () => void;
        onLoad?: () => void;
        className?: string;
    }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={alt}
            onError={onError}
            onLoad={onLoad}
            className={className}
            data-testid="avatar-img"
        />
    ),
}));

import { UiAvatar } from './UiAvatar';

describe('UiAvatar', () => {
    it('renders the fallback when no src is provided', () => {
        render(<UiAvatar src={null} alt="Jane Doe" fallback="JD" />);

        expect(screen.queryByTestId('avatar-img')).not.toBeInTheDocument();
        expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('renders the image when src is provided', () => {
        render(
            <UiAvatar
                src="https://example.com/a.jpg"
                alt="Jane Doe"
                fallback="JD"
            />
        );

        const img = screen.getByTestId('avatar-img') as HTMLImageElement;
        expect(img).toBeInTheDocument();
        expect(img.src).toBe('https://example.com/a.jpg');
        expect(screen.queryByText('JD')).not.toBeInTheDocument();
    });

    it('switches to the fallback when the image errors', () => {
        render(
            <UiAvatar
                src="https://example.com/broken.jpg"
                alt="Jane Doe"
                fallback="JD"
            />
        );

        fireEvent.error(screen.getByTestId('avatar-img'));

        expect(screen.queryByTestId('avatar-img')).not.toBeInTheDocument();
        expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('recovers and shows a new image when src changes after an error', () => {
        const { rerender } = render(
            <UiAvatar
                src="https://example.com/broken.jpg"
                alt="Jane Doe"
                fallback="JD"
            />
        );

        fireEvent.error(screen.getByTestId('avatar-img'));
        expect(screen.getByText('JD')).toBeInTheDocument();

        rerender(
            <UiAvatar
                src="https://example.com/fresh.jpg"
                alt="Jane Doe"
                fallback="JD"
            />
        );

        const img = screen.getByTestId('avatar-img') as HTMLImageElement;
        expect(img.src).toBe('https://example.com/fresh.jpg');
        expect(screen.queryByText('JD')).not.toBeInTheDocument();
    });

    it('exposes role="img" with the alt as accessible name', () => {
        render(
            <UiAvatar
                src="https://example.com/a.jpg"
                alt="Jane Doe"
                fallback="JD"
            />
        );

        const avatar = screen.getByRole('img', { name: 'Jane Doe' });
        expect(avatar.tagName).toBe('SPAN');
    });

    it('keeps the inner fallback hidden from assistive tech to avoid duplicate announcements', () => {
        render(<UiAvatar src={null} alt="Jane Doe" fallback="JD" />);

        // The visible text node is wrapped in an aria-hidden span, while
        // the root span is the single labeled region the screen reader
        // sees. There must be exactly one accessible "Jane Doe" image.
        expect(screen.getAllByRole('img', { name: 'Jane Doe' })).toHaveLength(
            1
        );
        expect(screen.getByText('JD').getAttribute('aria-hidden')).toBe('true');
    });
});
