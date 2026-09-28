/**
 * The map is allowed to carry colour now.
 *
 * The previous pair spent colour only on the border stroke and left
 * everything else grey, which read as a wireframe rather than as a place.
 * These give water, parks and hospitals their own hues — the reference is
 * Airbnb's map, where the land is warm, the water is genuinely blue, and
 * green space is legible at a glance — while keeping two constraints from
 * the old styles: commercial POIs stay off (they compete with our pins for
 * the same meaning), and `administrative.country` keeps the accent stroke,
 * because the border line is the product.
 *
 * `poi.medical` is the one POI category left visible. On a clinic directory
 * a hospital on the map is context, not clutter.
 *
 * Shared between MapView (the search results map) and ProviderMap (the
 * single-provider map on the provider page) so both agree on how the map
 * looks in light and dark theme, rather than each declaring its own copy.
 */
export const darkMapStyles: google.maps.MapTypeStyle[] = [
    { elementType: 'geometry', stylers: [{ color: '#1a1d21' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#12151a' }, { weight: 3 }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a8' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3a3f47' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d7dade' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#212429' }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#1e2430' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1c3b30' }, { visibility: 'on' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#5f9e83' }] },
    { featureType: 'poi.medical', elementType: 'geometry', stylers: [{ color: '#3a2630' }, { visibility: 'on' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#33363c' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1d21' }] },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#3e434a' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#6b5a34' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a1d21' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#e2c98d' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16303f' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5b93ad' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4fc79f' }, { weight: 2.4 }] },
];

export const lightMapStyles: google.maps.MapTypeStyle[] = [
    { elementType: 'geometry', stylers: [{ color: '#f4f1ea' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5a5f68' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#cfc9bd' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#14161a' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#eeeae1' }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e9e6db' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#c6e0c4' }, { visibility: 'on' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3d7a4e' }] },
    { featureType: 'poi.medical', elementType: 'geometry', stylers: [{ color: '#f3d9dd' }, { visibility: 'on' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e3ded2' }] },
    { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#3c4046' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fbe6b4' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e8cd93' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#1d1f24' }] },
    { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#6d7178' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a6cbe3' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2f6d8f' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#0f6b52' }, { weight: 2.4 }] },
];
