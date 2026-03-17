import React, { useState, useEffect } from 'react';
import { GoogleMap, Marker } from '@react-google-maps/api';
import { Box, Typography } from '@mui/material';

type LatLng = {
  lat: number;
  lng: number;
};

type Props = {
  homeLat?: number | null;
  homeLng?: number | null;
  workLat?: number | null;
  workLng?: number | null;
  currentLat?: number | null;
  currentLng?: number | null;
  /** Optional label for the home marker (e.g. "Location"). Default "Home". */
  homeMarkerLabel?: string;
  /** Optional tooltip for the home marker (shown on hover). */
  homeMarkerTitle?: string;
};

const containerStyle = {
  width: '100%',
  height: '400px',
};

const MapWithMarkers: React.FC<Props> = ({
  homeLat,
  homeLng,
  workLat,
  workLng,
  currentLat,
  currentLng,
  homeMarkerLabel = 'Home',
  homeMarkerTitle,
}) => {
  // Only render GoogleMap when the Maps API is fully ready (Map constructor available).
  // Poll until ready so we show the map when LoadScript finishes loading after mount.
  const [mapsReady, setMapsReady] = useState(() => typeof (window as any).google?.maps?.Map === 'function');
  useEffect(() => {
    if (mapsReady) return;
    const t = setInterval(() => {
      if (typeof (window as any).google?.maps?.Map === 'function') {
        setMapsReady(true);
      }
    }, 200);
    return () => clearInterval(t);
  }, [mapsReady]);
  const isLoaded = mapsReady;

  const [center, setCenter] = useState<LatLng | null>(null);

  useEffect(() => {
    if (homeLat !== null && homeLat !== undefined && homeLng !== null && homeLng !== undefined) {
      setCenter({ lat: homeLat, lng: homeLng });
    } else if (workLat !== null && workLat !== undefined && workLng !== null && workLng !== undefined) {
      setCenter({ lat: workLat, lng: workLng });
    } else if (currentLat !== null && currentLat !== undefined && currentLng !== null && currentLng !== undefined) {
      setCenter({ lat: currentLat, lng: currentLng });
    } else {
      setCenter(null);
    }
  }, [homeLat, homeLng, workLat, workLng, currentLat, currentLng]);

  if (!isLoaded) {
    return <Typography>Loading Map...</Typography>;
  }

  const hasHome =
    homeLat !== null && homeLat !== undefined && homeLng !== null && homeLng !== undefined;
  const hasWork =
    workLat !== null && workLat !== undefined && workLng !== null && workLng !== undefined;
  const hasCurrent =
    currentLat !== null &&
    currentLat !== undefined &&
    currentLng !== null &&
    currentLng !== undefined;

  if (!hasHome && !hasWork && !hasCurrent) {
    return <Typography sx={{ width: '100%', marginTop: '24px' }}>No location data available to display on the map.</Typography>;
  }

  return (
    <Box sx={{ width: '100%', marginTop: '24px' }}>
      {center && (
        <GoogleMap mapContainerStyle={{ width: '100%', height: '400px' }} center={center} zoom={12}>
          {hasHome && (
            <Marker
              key={`home-${homeLat}-${homeLng}`}
              position={{ lat: homeLat as number, lng: homeLng as number }}
              label={homeMarkerLabel}
              title={homeMarkerTitle}
            />
          )}
          {hasWork && (
            <Marker position={{ lat: workLat as number, lng: workLng as number }} label="Work" />
          )}
          {hasCurrent && (
            <Marker
              position={{ lat: currentLat as number, lng: currentLng as number }}
              label="Current"
            />
          )}
        </GoogleMap>
      )}
    </Box>
  );
};

export default React.memo(MapWithMarkers);
