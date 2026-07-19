import sprite from '../node_modules/@oxide/design-system/icons/sprite.svg?url';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

const Icon = ({ name, size = 24, className = '', ...props }: IconProps) => {
  const id = `${name}-${size}`;

  return (
    <svg 
      width={size} 
      height={size} 
      class={className}
      {...props}
    >
      <use href={`${sprite}#${id}`} />
    </svg>
  );
};

export default Icon;
