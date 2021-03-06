import Styled, { css } from 'styled-components/macro'
import { math, lighten, rgba } from 'polished'

const alertStyles = {
  success: css`
    background: ${p => rgba(p.theme.colors.success, 0.8)};
    border: 1px solid rgba(255,255,255, .3);
  `,
  danger: css`
    background: ${p => rgba(p.theme.colors.danger, 0.8)};
    border: 1px solid rgba(255,255,255, .3);
  `,
  default: css`
    background: ${p => rgba(lighten(0.05, p.theme.colors.bg), 0.95)};
    border: 1px solid rgba(255,255,255, .1);
  `
}

export const Alert = Styled.div`
  position: fixed;
  top: -180px;
  margin: 0 5px;
  width: calc(100% - ${p => math(`(${p.theme.sizes.gutter} * 2) + 10`)});
  max-width: ${p => math(`${p.theme.sizes.container} - 10px`)};
  padding: 65px 15px 15px;
  ${p => alertStyles[p.variant] || alertStyles.default}
  border-top: 0;
  box-shadow: 0px 5px 10px rgba(0,0,0, .3);
  border-radius: 0 0 5px 5px;
  animation: appear ease 1s 500ms forwards, disappear ease 2s 4s forwards;
  transform: translateZ(0);
  transition: top 1s ease;
  font-weight:300;
  z-index: 99;

  p {
    margin: 0 0 10px;
  }

  @keyframes appear {
    from { top: -180px }
    to { top: 0 }
  }
  @keyframes disappear {
    from { top: 0px }
    to { top: -180px }
  }
`
