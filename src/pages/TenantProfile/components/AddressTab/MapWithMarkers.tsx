import React, { useState, useEffect } from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
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
}) => {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places', 'maps'],
  });

  const [center, setCenter] = useState<LatLng | null>(null);

  useEffect(() => {
    if (homeLat && homeLng) {
      setCenter({ lat: homeLat, lng: homeLng });
    } else if (workLat && workLng) {
      setCenter({ lat: workLat, lng: workLng });
    } else if (currentLat && currentLng) {
      setCenter({ lat: currentLat, lng: currentLng });
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
    return <Typography>No location data available to display on the map.</Typography>;
  }

  return (
    <Box sx={{ width: '100%', marginTop: '24px' }}>
      {center && (
        <GoogleMap mapContainerStyle={{ width: '100%', height: '400px' }} center={center} zoom={12}>
          {hasHome && (
            <Marker position={{ lat: homeLat as number, lng: homeLng as number }} label="Home" />
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
