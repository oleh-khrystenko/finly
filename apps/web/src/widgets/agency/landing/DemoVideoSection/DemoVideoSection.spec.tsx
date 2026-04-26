import { render, screen } from '@testing-library/react';

import DemoVideoSection from './DemoVideoSection';

jest.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

jest.mock('@/shared/config/env', () => ({
    DEMO_VIDEO_ENABLED: true,
    DEMO_VIDEO: {
        src: 'https://media.cyanship.com/demo/cyanship-vsl.mp4',
        poster: 'https://media.cyanship.com/demo/cyanship-vsl-poster.jpg',
    },
}));

describe('DemoVideoSection', () => {
    it('renders native video playback for the configured demo asset', () => {
        render(<DemoVideoSection />);

        const video = screen.getByLabelText('heading');
        const playButton = screen.getByRole('button', { name: 'play_button' });

        expect(video.tagName).toBe('VIDEO');
        expect(playButton).toBeInTheDocument();
        expect(video).toHaveAttribute(
            'poster',
            'https://media.cyanship.com/demo/cyanship-vsl-poster.jpg'
        );
        expect(video.querySelector('source')).toHaveAttribute(
            'src',
            'https://media.cyanship.com/demo/cyanship-vsl.mp4'
        );
        expect(document.querySelector('iframe')).not.toBeInTheDocument();
    });
});
