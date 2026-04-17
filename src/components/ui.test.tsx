import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, Pill, EmptyState, LoadingState } from '../components/ui';

describe('UI Components', () => {
  describe('Button', () => {
    it('renders with default props', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button')).toHaveTextContent('Click me');
    });

    it('renders with primary kind', () => {
      render(<Button kind="primary">Primary</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('button-primary');
    });

    it('is disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('calls onClick when clicked', async () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>Click</Button>);
      const button = screen.getByRole('button');
      button.click();
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe('Pill', () => {
    it('renders with neutral tone by default', () => {
      render(<Pill>Label</Pill>);
      const pill = screen.getByText('Label');
      expect(pill).toHaveClass('pill-neutral');
    });

    it('renders with specified tone', () => {
      render(<Pill tone="good">Good</Pill>);
      const pill = screen.getByText('Good');
      expect(pill).toHaveClass('pill-good');
    });
  });

  describe('EmptyState', () => {
    it('renders title and description', () => {
      render(<EmptyState title="No data" description="Nothing to show" />);
      expect(screen.getByText('No data')).toBeInTheDocument();
      expect(screen.getByText('Nothing to show')).toBeInTheDocument();
    });
  });

  describe('LoadingState', () => {
    it('renders default label', () => {
      render(<LoadingState />);
      expect(screen.getByText('加载中')).toBeInTheDocument();
    });

    it('renders custom label', () => {
      render(<LoadingState label="Loading profiles" />);
      expect(screen.getByText('Loading profiles')).toBeInTheDocument();
    });

    it('renders skeleton when skeleton prop is true', () => {
      render(<LoadingState skeleton />);
      // Skeleton 应该渲染骨架元素而不是文本
      expect(screen.queryByText('加载中')).not.toBeInTheDocument();
    });
  });
});
