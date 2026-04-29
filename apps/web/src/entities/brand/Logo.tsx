import Image from 'next/image';

const LOGO_ICON_SIZE = 32;

const Logo = () => {
    return (
        <div className="flex items-center gap-2">
            <Image
                src="/logo/light-theme.svg"
                alt="NeatSlip"
                width={LOGO_ICON_SIZE}
                height={LOGO_ICON_SIZE}
                className="block dark:hidden"
            />
            <Image
                src="/logo/dark-theme.svg"
                alt="NeatSlip"
                width={LOGO_ICON_SIZE}
                height={LOGO_ICON_SIZE}
                className="hidden dark:block"
            />
            <span className="text-foreground text-2xl font-bold">
                NeatSlip
            </span>
        </div>
    );
};

export default Logo;
