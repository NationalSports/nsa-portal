import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorWaysEditor } from '../components';
jest.mock('../DstPreview', () => ({
  useDstDesign: () => ({design:{blocks:[{}, {}, {}],stitches:100}}),
  DstTile: () => <div>DST colored preview</div>, StitchBadge: () => null,
  StitchNotes: () => null, StitchLoading: () => null, stitchPngFile:jest.fn(),
}));

test('opening an old color way does not add stops or autosave; rep can keep all colors', () => {
  jest.useFakeTimers();
  const onChange=jest.fn(), onAutoLogo=jest.fn();
  render(<ColorWaysEditor colorWays={[{id:'blue',inks:['White','Red'],garment_color:'Blue'}]} onChange={onChange} decoType="embroidery" stitch={{dstUrl:'https://example.com/a.dst',onAutoLogo}}/>);
  jest.advanceTimersByTime(2000);
  expect(onChange).not.toHaveBeenCalled();
  expect(onAutoLogo).not.toHaveBeenCalled();
  expect(screen.queryByText('DST colored preview')).toBeNull();
  expect(screen.getByRole('checkbox').disabled).toBe(true);
  fireEvent.click(screen.getByText('+ Add thread color'));
  expect(onChange.mock.calls[0][0][0].inks).toEqual(['White','Red','']);
  jest.useRealTimers();
});
