import { render, screen } from '@testing-library/react';
import { OwnershipBadge } from './OwnershipBadge';

describe('OwnershipBadge', () => {
    it('isOwner=true → «Ви власник», нейтральний (muted) варіант', () => {
        render(<OwnershipBadge isOwner />);
        const badge = screen.getByText('Ви власник');
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('text-muted-foreground');
    });

    it('isOwner=false → «Ви бухгалтер», акцентний (primary) варіант', () => {
        render(<OwnershipBadge isOwner={false} />);
        const badge = screen.getByText('Ви бухгалтер');
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('text-primary');
    });
});
