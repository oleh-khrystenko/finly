'use client';

import { useRef, useState } from 'react';
import { Play } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

interface DemoVideoPlayerProps {
    title: string;
    src: string;
    poster: string | null;
    playLabel: string;
}

export default function DemoVideoPlayer({
    title,
    src,
    poster,
    playLabel,
}: DemoVideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [showPlayOverlay, setShowPlayOverlay] = useState(true);

    const handlePlayOverlayClick = async () => {
        const video = videoRef.current;
        if (!video) return;

        try {
            await video.play();
        } catch {
            // Keep the overlay visible if playback cannot start.
        }
    };

    return (
        <div className="border-border overflow-hidden rounded-xl border bg-black">
            <div className="group relative aspect-video">
                <video
                    ref={videoRef}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={title}
                    className="absolute inset-0 size-full"
                    onPlay={() => setShowPlayOverlay(false)}
                    onPause={() => setShowPlayOverlay(true)}
                    onEnded={() => setShowPlayOverlay(true)}
                    {...(poster ? { poster } : {})}
                >
                    <source src={src} />
                </video>

                {showPlayOverlay && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity duration-200">
                        <UiButton
                            variant="icon"
                            size="lg"
                            aria-label={playLabel}
                            className="border-primary/25 text-primary hover:border-primary/40 hover:text-primary focus-visible:ring-ring hover:bg-muted pointer-events-auto size-16 rounded-full border bg-black/70 p-0 shadow-lg backdrop-blur-sm transition-all hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                            IconLeft={
                                <Play className="ml-0.5 size-6 fill-current" />
                            }
                            onClick={handlePlayOverlayClick}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
