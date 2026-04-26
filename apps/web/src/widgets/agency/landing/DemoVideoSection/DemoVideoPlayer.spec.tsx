import { fireEvent, render, screen } from '@testing-library/react';

import DemoVideoPlayer from './DemoVideoPlayer';

describe('DemoVideoPlayer', () => {
    const playMock = jest.fn(function (this: HTMLMediaElement) {
        fireEvent.play(this);
        return Promise.resolve();
    });

    beforeAll(() => {
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
            configurable: true,
            writable: true,
            value: playMock,
        });
    });

    beforeEach(() => {
        playMock.mockClear();
    });

    it('shows a centered play overlay before playback starts', () => {
        render(
            <DemoVideoPlayer
                title="Demo"
                src="https://media.cyanship.com/demo/cyanship-vsl.mp4"
                poster="https://media.cyanship.com/demo/cyanship-vsl-poster.jpg"
                playLabel="Play video"
            />
        );

        expect(
            screen.getByRole('button', { name: 'Play video' })
        ).toBeInTheDocument();
    });

    it('starts playback from the overlay button and hides it while playing', async () => {
        render(
            <DemoVideoPlayer
                title="Demo"
                src="https://media.cyanship.com/demo/cyanship-vsl.mp4"
                poster="https://media.cyanship.com/demo/cyanship-vsl-poster.jpg"
                playLabel="Play video"
            />
        );

        const playButton = screen.getByRole('button', { name: 'Play video' });
        const video = screen.getByLabelText('Demo');

        fireEvent.click(playButton);

        expect(playMock).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();

        fireEvent.ended(video);

        expect(
            screen.getByRole('button', { name: 'Play video' })
        ).toBeInTheDocument();
    });

    it('shows the overlay again when playback is paused mid-video', () => {
        render(
            <DemoVideoPlayer
                title="Demo"
                src="https://media.cyanship.com/demo/cyanship-vsl.mp4"
                poster="https://media.cyanship.com/demo/cyanship-vsl-poster.jpg"
                playLabel="Play video"
            />
        );

        const playButton = screen.getByRole('button', { name: 'Play video' });
        const video = screen.getByLabelText('Demo');

        fireEvent.click(playButton);
        expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();

        fireEvent.pause(video);

        expect(
            screen.getByRole('button', { name: 'Play video' })
        ).toBeInTheDocument();
    });
});
