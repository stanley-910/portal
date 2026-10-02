// components/bundle.js reads React from window; make sure it is there first.
import * as React from 'react';

if (!globalThis.React) globalThis.React = React;
