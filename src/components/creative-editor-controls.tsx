'use client';

import { Checkbox } from '@heroui/react/checkbox';
import { Slider } from '@heroui/react/slider';
import { TextArea } from '@heroui/react/textarea';
import { Input } from '@heroui/react/input';
import type { VideoEditorControls } from '@cjfclonedeep/capability-sdk/media/video-editor';
import { CustomSelect } from './CustomSelect';
import { CreativeButton } from './ui/creative-button';

/** Keep the SDK editor independent of the host's design system. */
export const creativeEditorControls: VideoEditorControls = {
  Button: CreativeButton,
  Input: props => <Input fullWidth {...props} />,
  TextArea: props => <TextArea fullWidth {...props} />,
  Select: ({ label, ...props }) => <CustomSelect ariaLabel={label} title={label} {...props} />,
  Range: ({ label, disabled, min, max, onChange, ...props }) => <Slider className="creative-editor-slider" aria-label={label} isDisabled={disabled} minValue={min} maxValue={max} onChange={value => onChange(Array.isArray(value) ? value[0] : value)} {...props}>
    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
  </Slider>,
  Checkbox: ({ label, checked, disabled, onChange }) => <Checkbox isSelected={checked} isDisabled={disabled} onChange={onChange}>
    <Checkbox.Content aria-label={label}><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{label}</span></Checkbox.Content>
  </Checkbox>,
};
